// The agent loop (SPEC §1.1): one user message in a thread, run to completion.
// The model gets a constant system prompt and one tool, `run`, whose
// description declares the region's module. Each call typechecks and runs a
// script in the sandbox with fresh bindings, records the run and its reads,
// and returns the transcript as the tool result. It repeats until the model
// stops, a per-thread cap ends the turn (SPEC §9), or the signal aborts. Each
// response may use only what the thread's token cap leaves.
//
// One change set per turn: the mutations of the last run in the turn that
// finished and captured any. A later run replaces an earlier one's, as the
// model is told, and a run that fails captures nothing. The change set is
// captured when the turn ends, however it ends, except on abort.
import { createHash } from "node:crypto";
import {
  array,
  type Bindings,
  type CapturedMutation,
  isInstant,
  isItemId,
  type Log,
  object,
  refine,
  type Run,
  type RunLimits,
  type RunResult,
  type SearchHit,
  string,
  type Ulid,
} from "@oriel/core";
import type { Agent, AgentDeps, AgentEvent, TurnInput } from "./contract.ts";
import { runResultText, runTool, runToolName, systemPrompt, threadMessages } from "./prompt.ts";
import {
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

// What the bindings' `search()` answers with, checked before it reaches the
// window.
const searchHits = array(
  object({
    id: refine(string, isItemId, "expected an item ID"),
    title: string,
    location: string,
    updatedAt: refine(string, isInstant, "expected an instant"),
  }),
);

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

type End = Extract<ModelEvent, { kind: "end" }>;

// With less room than this left under the token cap, the turn stops rather
// than ask for a response: with thinking always on, a reply needs room to
// think as well as answer.
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
  const { thread, region } = input;
  const { limits } = deps;
  const log: Log = (message, fields) => baseLog(message, { thread_id: thread.id, ...fields });
  // This turn's tokens: every finished response, and what a response cut off
  // by an abort or a failure had reported (`inFlight`), so `done` and the
  // thread's `spent` count it too.
  const used = { inputTokens: 0, outputTokens: 0 };
  let inFlight: Usage = noUsage;
  const settle = () => {
    used.inputTokens += inFlight.inputTokens;
    used.outputTokens += inFlight.outputTokens;
    inFlight = noUsage;
  };
  const spent = input.spent.inputTokens + input.spent.outputTokens;
  const total = () => spent + used.inputTokens + used.outputTokens;
  // What the cap leaves for the next response's output, after its input:
  // `nextInput` is what the turn already knows of that input, the previous
  // response's input and output, which the next request sends again.
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
  // A run may capture no more than a change set may hold.
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

  // The turn's change set to be: the last finished run's captured mutations.
  const turnState: { proposal: { runId: Ulid; mutations: CapturedMutation[] } | null } = {
    proposal: null,
  };

  // One `run` call: refused without a run if it isn't one, else a run in the
  // sandbox, recorded whatever its outcome. `charge` is the usage of the
  // response that asked for it.
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
    const bindings = deps.bindingsFor(region);
    const runId = deps.newId();
    const startedAt = deps.now();
    const runLog: Log = (message, fields) => log(message, { run_id: runId, ...fields });
    // The window shows what the escape hatch found as its own block; the
    // sandbox keeps only each read's hash. A run's searches share the block,
    // so an item two of them found is in it once, where it was first found.
    const hits = new Map<string, SearchHit>();
    const watched: Bindings = {
      dts: bindings.dts,
      shim: bindings.shim,
      capture: (fn, args, ref) => bindings.capture(fn, args, ref),
      read: async (fn, args) => {
        const answer = await bindings.read(fn, args);
        const found = fn === "search" ? searchHits(answer.value) : null;
        for (const hit of found?.ok ? found.value : [])
          if (!hits.has(hit.id)) hits.set(hit.id, hit);
        return answer;
      },
    };
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
      result = await deps.sandbox.run(script, watched, {
        limits: runLimits,
        signal,
        log: runLog,
      });
    } catch (error) {
      record(signal.aborted ? "aborted" : "threw", null);
      throw error;
    }
    record(result.outcome, result);
    // A run-level cap (wall time, reads, mutations, output) shows here as the
    // run's outcome, not as a `limit`: the model reads the error and can go on.
    yield { kind: "run.finished", runId, result };
    if (hits.size) yield { kind: "search", runId, hits: [...hits.values()] };
    let replaced = 0;
    if (result.outcome === "ok" && result.mutations.length) {
      replaced = turnState.proposal?.mutations.length ?? 0;
      turnState.proposal = { runId, mutations: result.mutations };
    }
    return {
      callId: call.id,
      content: runResultText(result, replaced),
      isError: result.outcome !== "ok",
    };
  }

  try {
    const conversation = deps.provider.converse({
      system: systemPrompt,
      tools: [runTool(deps.bindingsFor(region).dts)],
      messages: threadMessages(input.history, input.text),
      signal,
      log,
    });
    let results: ToolResult[] = [];
    let nextInput = 0;
    for (;;) {
      signal.throwIfAborted();
      // Each response may use only what the cap leaves, and none is asked
      // for when that isn't enough for a useful one.
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
      // A run whose result no response could read would act for nothing: no
      // reads, no record, no change set.
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
  }

  const { proposal } = turnState;
  if (proposal && !signal.aborted) {
    const { runId, mutations } = proposal;
    try {
      const changeSet = await deps.changeSets.capture(
        { id: runId, threadId: thread.id, workspaceId: thread.workspaceId },
        mutations,
      );
      log("agent.change-set", {
        run_id: runId,
        change_set_id: changeSet.id,
        mutations: mutations.length,
      });
      yield { kind: "change-set", changeSetId: changeSet.id };
    } catch (error) {
      yield failed(`The proposed changes couldn't be saved for review: ${errorText(error)}`);
    }
  }
  yield done();
}
