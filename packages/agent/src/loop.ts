import { createHash } from "node:crypto";
import { type Log, object, type Run, type RunLimits, type RunResult, string } from "@oriel/core";
import type { Agent, AgentDeps, AgentEvent, TurnInput } from "./contract.ts";
import { turnShown } from "./blocks.ts";
import { challengeOf, proposal } from "./proposal.ts";
import { runResultText, runTool, runToolName, systemPrompt, threadMessages } from "./prompt.ts";
import {
  type Conversation,
  errorText,
  type ModelEvent,
  noUsage,
  ProviderError,
  type ToolCall,
  type ToolResult,
  type Usage,
} from "./provider.ts";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

export const systemPromptHash = sha256(systemPrompt);

const runInput = object({ script: string });

type End = Extract<ModelEvent, { kind: "end" }>;

// With thinking always on, a reply needs room to think as well as answer.
export const minResponseTokens = 4_096;

export function agent(deps: AgentDeps): Agent {
  return { turn: (input, options) => turn(deps, input, options.signal, options.log) };
}

async function* turn(
  deps: AgentDeps,
  input: TurnInput,
  signal: AbortSignal,
  baseLog: Log,
): AsyncGenerator<AgentEvent, void, undefined> {
  const { thread } = input;
  let { region } = input;
  const { limits } = deps;
  const log: Log = (message, fields) => baseLog(message, { thread_id: thread.id, ...fields });
  const used = { inputTokens: 0, outputTokens: 0 };
  let inFlight: Usage = noUsage;
  const settle = () => {
    used.inputTokens += inFlight.inputTokens;
    used.outputTokens += inFlight.outputTokens;
    inFlight = noUsage;
  };
  const spent = input.spent.inputTokens + input.spent.outputTokens;
  const total = () => spent + used.inputTokens + used.outputTokens;
  const room = (nextInput: number) => limits.maxTokensPerThread - total() - nextInput;
  const done = (): AgentEvent => ({ kind: "done", usage: { ...used } });
  const limit = (reason: string): AgentEvent => {
    log("agent.limit", { reason });
    return { kind: "limit", reason };
  };
  const failed = (message: string): AgentEvent => {
    log("agent.error", { error: message });
    return { kind: "error", message };
  };
  const tokenLimit = () =>
    limit(
      `This thread has reached its budget of ${limits.maxTokensPerThread} tokens, so the agent stopped.`,
    );
  const runLimits: RunLimits = {
    ...limits.run,
    maxMutations: Math.min(limits.run.maxMutations, limits.maxMutationsPerChangeSet),
  };

  const turns = input.history.filter((message) => message.role === "user").length + 1;
  log("agent.turn", { turn: turns, history: input.history.length, region_version: region.version });
  if (turns > limits.maxTurnsPerThread) {
    yield limit(
      `This thread has reached its limit of ${limits.maxTurnsPerThread} messages. Start a new thread on the workstream to keep going.`,
    );
    yield done();
    return;
  }
  if (room(0) < minResponseTokens) {
    yield tokenLimit();
    yield done();
    return;
  }
  if (region.workstreamId !== thread.workstreamId || region.workspaceId !== thread.workspaceId) {
    yield failed("This turn's region isn't a version of the thread's workstream.");
    yield done();
    return;
  }

  const proposed = proposal();
  const turnShows = turnShown(deps.newId);

  async function* runCall(
    call: ToolCall,
    charge: Usage,
    model: string,
  ): AsyncGenerator<AgentEvent, ToolResult, undefined> {
    const refuse = (content: string): ToolResult => ({ callId: call.id, content, isError: true });
    if (call.name !== runToolName)
      return refuse(`There is no tool named ${JSON.stringify(call.name)}; the only tool is run.`);
    const parsed = runInput(call.input);
    if (!parsed.ok)
      return refuse("The run tool takes an object with one field, script: a string of TypeScript.");
    const { script } = parsed.value;
    signal.throwIfAborted();
    const runId = deps.newId();
    const shown = turnShows.run(runId, (asked) =>
      deps.bindingsFor(region, thread.id, asked, proposed.runOptions(deps, input, runId)),
    );
    const { bindings } = shown;
    const startedAt = deps.now();
    const runLog: Log = (message, fields) => log(message, { run_id: runId, ...fields });
    const record = (outcome: Run["outcome"], result: RunResult | null) =>
      deps.runs.record(
        {
          id: runId,
          workspaceId: thread.workspaceId,
          threadId: thread.id,
          snapshot: input.snapshot,
          regionVersion: region.version,
          systemPromptHash,
          dtsHash: sha256(bindings.dts),
          model,
          inputTokens: charge.inputTokens,
          outputTokens: charge.outputTokens,
          wallMs: result?.wallMs ?? Date.parse(deps.now()) - Date.parse(startedAt),
          coldStartMs: result?.coldStartMs ?? null,
          outcome,
          startedAt,
        },
        result?.reads ?? [],
      );

    yield { kind: "run.started", runId, script };
    let result: RunResult;
    try {
      result = await deps.sandbox.run(script, bindings, {
        limits: runLimits,
        signal,
        log: runLog,
      });
    } catch (error) {
      record(signal.aborted ? "aborted" : "threw", null);
      throw error;
    }
    record(result.outcome, result);
    yield { kind: "run.finished", runId, result };
    yield* shown.ran(result);
    const joined = yield* proposed.joined(deps, input, region, runId, result, signal, log);
    const moved = joined.region.version !== region.version;
    region = joined.region;
    const now = moved
      ? deps.bindingsFor(region, thread.id, undefined, challengeOf(input, runId)).dts
      : undefined;
    const replaced = proposed.ran(runId, joined.result);
    return {
      callId: call.id,
      content: runResultText(
        joined.result,
        replaced.mutations,
        replaced.intents,
        shown.said,
        replaced.drafts,
        joined.lines,
        now,
        proposed.revises(runId),
      ),
      isError: result.outcome !== "ok",
    };
  }

  const declared = deps.bindingsFor(
    region,
    thread.id,
    undefined,
    challengeOf(input, thread.id),
  ).dts;
  let conversation: Conversation | null = null;
  try {
    conversation = deps.provider.converse({
      system: systemPrompt,
      tools: [runTool(declared)],
      messages: threadMessages(input.history, input.text, input.about, input.windowChat),
      signal,
      log,
    });
    let results: ToolResult[] = [];
    let nextInput = 0;
    for (;;) {
      signal.throwIfAborted();
      const maxOutputTokens = room(nextInput);
      if (maxOutputTokens < minResponseTokens) {
        yield tokenLimit();
        break;
      }
      const calls: ToolCall[] = [];
      let end: End | null = null;
      for await (const event of conversation.next(results, { maxOutputTokens })) {
        if (event.kind === "text") yield { kind: "text", text: event.text };
        else if (event.kind === "usage") inFlight = event.usage;
        else if (event.kind === "call") calls.push(event.call);
        else end = event;
      }
      if (!end) throw new ProviderError("The model's response ended without saying why.");
      inFlight = end.usage;
      settle();
      nextInput = end.usage.inputTokens + end.usage.outputTokens;
      log("agent.response", {
        stop: end.stop,
        model: end.model,
        calls: calls.length,
        input_tokens: end.usage.inputTokens,
        output_tokens: end.usage.outputTokens,
        cache_read_tokens: end.usage.cacheReadTokens,
        cache_write_tokens: end.usage.cacheWriteTokens,
      });
      if (end.stop === "refused") {
        const why = end.detail ? ` (${end.detail})` : "";
        yield failed(`The model declined to continue${why}. Try asking another way.`);
        break;
      }
      if (end.stop === "max-tokens") {
        // A provider sends the smaller of its own ceiling and the bound, so
        // output that reached the bound was cut off by the thread's budget.
        yield end.usage.outputTokens >= maxOutputTokens
          ? tokenLimit()
          : failed("The model's reply was cut off before it finished.");
        break;
      }
      if (end.stop === "other") {
        yield failed(`The model stopped unexpectedly (${end.detail ?? "no reason given"}).`);
        break;
      }
      if (!calls.length) break;
      if (room(nextInput) < minResponseTokens) {
        yield limit(
          `This thread ran out of its budget of ${limits.maxTokensPerThread} tokens before the agent could act on the request.`,
        );
        break;
      }
      results = [];
      let charge: Usage = end.usage;
      for (const call of calls) {
        results.push(yield* runCall(call, charge, end.model));
        charge = noUsage;
      }
    }
  } catch (error) {
    settle();
    if (signal.aborted) {
      log("agent.aborted", { input_tokens: used.inputTokens, output_tokens: used.outputTokens });
      yield done();
      return;
    }
    yield failed(errorText(error));
  } finally {
    conversation?.close?.();
  }

  yield* turnShows.settle();
  if (!input.challenge) yield* proposed.settle(deps, thread, signal, log);
  yield done();
}
