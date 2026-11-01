// A scripted stand-in for the agent, for tests and for `pnpm dev` until
// @oriel/agent is wired in. It speaks the same contract and uses the same
// deps. A turn follows a plan instead of a model, but its runs are real: the
// sandbox runs each script against the region's bindings, the run is
// recorded, and what it captures becomes a change set.
import { createHash } from "node:crypto";
import { array, type Log, parseItemId, type RunResult } from "@oriel/core";
import {
  type Agent,
  type ServerAgentDeps,
  type AgentEvent,
  searchHit,
  type TurnInput,
} from "./agent.ts";

// Text to say, a script to run, or a search, which is a run whose result
// renders as its own block.
export type Step = { text: string } | { run: string } | { search: string };

// Its system prompt is a constant, like the real agent's: no source content.
const systemPrompt = "oriel scripted agent v1";
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

function returned(result: RunResult): unknown {
  const entry = result.transcript.findLast((e) => e.kind === "return");
  return entry?.kind === "return" ? entry.value : undefined;
}

// As the contract asks, a turn ends with exactly one `done`, stopped or not.
export function scriptedAgent(deps: ServerAgentDeps, plan: (input: TurnInput) => Step[]): Agent {
  return {
    async *turn(input, options): AsyncGenerator<AgentEvent> {
      try {
        yield* steps(deps, plan, input, options);
      } catch (error) {
        if (!options.signal.aborted)
          yield {
            kind: "error",
            message: error instanceof Error ? error.message : String(error),
          };
      }
      yield { kind: "done", usage: { inputTokens: 0, outputTokens: 0 } };
    },
  };
}

async function* steps(
  deps: ServerAgentDeps,
  plan: (input: TurnInput) => Step[],
  input: TurnInput,
  { signal, log }: Parameters<Agent["turn"]>[1],
): AsyncGenerator<AgentEvent> {
  const { thread, region } = input;
  for (const step of plan(input)) {
    if (signal.aborted) return;
    if ("text" in step) {
      yield { kind: "text", text: step.text };
      continue;
    }
    const script =
      "run" in step ? step.run : `return await search(${JSON.stringify(step.search)}, 10);`;
    const runId = deps.newId();
    yield { kind: "run.started", runId, script };
    const bindings = deps.bindingsFor(region);
    const startedAt = deps.now();
    const run = {
      id: runId,
      workspaceId: thread.workspaceId,
      threadId: thread.id,
      snapshot: input.snapshot,
      regionVersion: region.version,
      systemPromptHash: sha256(systemPrompt),
      dtsHash: sha256(bindings.dts),
      model: "scripted",
      inputTokens: 0,
      outputTokens: 0,
      startedAt,
    };
    // Every line the run logs, each proxied read included, names the run as
    // well as the thread (SPEC §9).
    const runLog: Log = (message, fields) => log(message, { ...fields, run_id: runId });
    let result: RunResult;
    try {
      result = await deps.sandbox.run(script, bindings, {
        limits: deps.limits.run,
        signal,
        log: runLog,
      });
    } catch (error) {
      if (signal.aborted)
        deps.runs.record({ ...run, wallMs: 0, coldStartMs: null, outcome: "aborted" }, []);
      throw error;
    }
    deps.runs.record(
      {
        ...run,
        wallMs: result.wallMs,
        coldStartMs: result.coldStartMs,
        outcome: result.outcome,
      },
      result.reads,
    );
    yield { kind: "run.finished", runId, result };
    // A model reads a failed run and answers from it; the rest of the plan
    // assumed the run worked, so the turn ends here, saying why.
    const failed = result.transcript.findLast((e) => e.kind === "error");
    if (result.outcome !== "ok" && failed?.kind === "error") {
      yield { kind: "text", text: `Nothing to propose: ${failed.error.message}.` };
      return;
    }
    if ("search" in step) {
      const hits = array(searchHit)(returned(result));
      if (hits.ok) yield { kind: "search", runId, hits: hits.value };
    }
    if (result.mutations.length === 0) continue;
    if (result.mutations.length > deps.limits.maxMutationsPerChangeSet) {
      yield {
        kind: "error",
        message: `A change set holds at most ${deps.limits.maxMutationsPerChangeSet} changes.`,
      };
      continue;
    }
    try {
      const set = await deps.changeSets.capture(
        { id: runId, threadId: thread.id, workspaceId: thread.workspaceId },
        result.mutations,
      );
      yield { kind: "change-set", changeSetId: set.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      yield { kind: "error", message: `That change couldn't be proposed: ${message}` };
    }
  }
}

const listScript = `const all = await items.list();
return all.map((item) =>
  item.gone ? \`\${item.id}: \${item.reason}\` : \`\${item.id}: \${item.text.length} characters\`,
);`;

const estimateScript = `const stories = await jira.listItems();
const unestimated = stories.flatMap((story) =>
  story.gone || story.points !== null || story.issueType === "Epic" ? [] : [story.id],
);
for (const id of unestimated.slice(0, 3)) jira.setEstimate(id, 3);
return unestimated.slice(0, 3);`;

const searchAsk = /\b(?:search|find|look)\s+(?:for\s+)?(.+)/i;
// Words a person adds around what they're looking for, which an index search
// would require every item to contain.
const filler = new Set([
  "a",
  "about",
  "an",
  "anything",
  "any",
  "everything",
  "for",
  "in",
  "items",
  "mentioning",
  "of",
  "on",
  "something",
  "stories",
  "that",
  "the",
  "to",
  "with",
]);

// What `pnpm dev` answers with: a search when asked to find something, an
// estimate change when asked about estimates, and otherwise a read of every
// item in the region.
export function devPlan(input: TurnInput): Step[] {
  const query = searchAsk
    .exec(input.text)?.[1]
    ?.replace(/[?.!"]+/g, " ")
    .split(/\s+/)
    .filter((word) => word && !filler.has(word.toLowerCase()))
    .join(" ");
  if (query)
    return [
      { text: "I'll look across the whole window, not just this group." },
      { search: query },
      { text: "Those come from outside this group, so they're read-only here." },
    ];
  if (/\b(estimate|estimates|points|unestimated)\b/i.test(input.text)) {
    const jira = input.region.items.some((item) => parseItemId(item.id)?.source === "jira");
    if (!jira) return [{ text: "Nothing in this group can be estimated: it has no Jira items." }];
    return [
      { text: "I'll find stories here without an estimate and propose 3 points for each." },
      { run: estimateScript },
      {
        text: "If any needed one, the proposed change is below. Nothing is written until you approve it.",
      },
    ];
  }
  return [
    { text: "Here's every item in this group, read live." },
    { run: listScript },
    {
      text: "I'm the scripted agent for local development. Ask about estimates to see a change set, or ask me to find something outside the group.",
    },
  ];
}
