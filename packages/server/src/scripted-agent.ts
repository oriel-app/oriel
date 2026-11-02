// A scripted stand-in for the agent, for tests and for `pnpm dev` until
// @oriel/agent is wired in. It speaks the same contract and uses the same
// deps. A turn follows a plan instead of a model, but its runs are real: the
// sandbox runs each script against the region's bindings, and the run is
// recorded. What the last run to capture writes captured becomes the change
// set, and the last run's intents apply, as for any agent (`proposal`).
import { createHash } from "node:crypto";
import { proposal } from "@oriel/agent";
import { array, type Log, parseItemId, type RunResult, type ThreadFound } from "@oriel/core";
import {
  type Agent,
  type ServerAgentDeps,
  type AgentEvent,
  searchHit,
  type TurnInput,
} from "./agent.ts";

// Text to say, a script to run, a search, which is a run whose result
// renders as its own block, or a look through Oriel's own threads, which
// answers with a link to the best match.
export type Step = { text: string } | { run: string } | { search: string } | { threads: string };

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
  const proposed = proposal();
  // A run may capture no more than a change set may hold.
  const limits = {
    ...deps.limits.run,
    maxMutations: Math.min(deps.limits.run.maxMutations, deps.limits.maxMutationsPerChangeSet),
  };
  for (const step of plan(input)) {
    if (signal.aborted) return;
    if ("text" in step) {
      yield { kind: "text", text: step.text };
      continue;
    }
    const script =
      "run" in step
        ? step.run
        : "search" in step
          ? `return await search(${JSON.stringify(step.search)}, 10);`
          : `return await thread.find(${JSON.stringify(step.threads)}, 1);`;
    const runId = deps.newId();
    yield { kind: "run.started", runId, script };
    const bindings = deps.bindingsFor(region, thread.id);
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
        limits,
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
    // assumed the run worked, so the turn ends here, saying why, with what
    // earlier runs proposed.
    const failed = result.transcript.findLast((e) => e.kind === "error");
    if (result.outcome !== "ok" && failed?.kind === "error") {
      yield { kind: "text", text: `Nothing to propose: ${failed.error.message}.` };
      break;
    }
    if ("search" in step) {
      const hits = array(searchHit)(returned(result));
      if (hits.ok) yield { kind: "search", runId, hits: hits.value };
    }
    if ("threads" in step) yield { kind: "text", text: linkTo(returned(result)) };
    proposed.ran(runId, result);
  }
  yield* proposed.settle(deps, thread, signal, log);
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

// Takes the finished stories out of the workstream, and closes the thread
// when asked to: Oriel's own actions, applied as the turn ends.
const tidyScript = (close: boolean) => `const stories = await jira.listItems();
const finished = stories.flatMap((story) =>
  story.gone || story.issueType === "Epic" || story.status.category !== "done" ? [] : [story.id],
);
if (finished.length) workstream.remove({ items: finished });
${close ? "thread.done();\n" : ""}return finished;`;

// Posts `text` beside the workstream's first Slack conversation, in its channel,
// or replies in that conversation (OA-28).
const slackScript = (fn: "postMessage" | "reply", text: string) => `const ids = (await items.list())
  .map((item) => item.id)
  .filter((id): id is SlackId => id.startsWith("slack:"));
const [first] = ids;
if (first) slack.${fn}(first, ${JSON.stringify(text)});
return first ?? null;`;
const slackAsk = /^\s*(post|reply)\b[:\s]*([\s\S]*)$/i;

const searchAsk = /\b(?:search|find|look)\s+(?:for\s+)?(.+)/i;
const threadsAsk = /^\s*where\b/i;

// A reply linking to the first thing thread.find() returned, as the agent's
// would.
function linkTo(found: unknown): string {
  const [first] = Array.isArray(found) ? found : [];
  const hit = typeof first === "object" && first !== null ? (first as Partial<ThreadFound>) : {};
  const { thread, changeSet } = hit;
  if (!thread) return "I couldn't find that in any thread.";
  const name = thread.name ?? "a new thread";
  return changeSet
    ? `It was this change set, in [${name}](${changeSet.link}).`
    : `It was in [${name}](${thread.link}).`;
}
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

// What `pnpm dev` answers with: a link to a thread when asked where
// something happened, a search when asked to find something, an estimate
// change when asked about estimates, the finished stories taken out of the
// workstream when asked to (and the thread closed, if asked), a Slack post
// or reply when asked to "post: …" or "reply: …", and otherwise a read of
// every item in the region.
export function devPlan(input: TurnInput): Step[] {
  if (threadsAsk.test(input.text))
    return [
      { text: "I'll look through your threads." },
      { threads: input.text.replace(/[?.!"]+/g, " ").trim() },
    ];
  const slackAsked = slackAsk.exec(input.text);
  if (slackAsked) {
    const fn = slackAsked[1]?.toLowerCase() === "reply" ? "reply" : "postMessage";
    const slack = input.region.items.some((item) => parseItemId(item.id)?.source === "slack");
    if (!slack)
      return [{ text: "Nothing in this workstream is in Slack, so there's nowhere to post." }];
    const text = slackAsked[2]?.trim() || "A smoke test from Oriel's dev server.";
    return [
      {
        text:
          fn === "reply"
            ? "I'll reply in this workstream's first Slack conversation."
            : "I'll post in the channel of this workstream's first Slack conversation.",
      },
      { run: slackScript(fn, text) },
      { text: "The proposed change is below. Nothing is posted until you approve it." },
    ];
  }
  const query = searchAsk
    .exec(input.text)?.[1]
    ?.replace(/[?.!"]+/g, " ")
    .split(/\s+/)
    .filter((word) => word && !filler.has(word.toLowerCase()))
    .join(" ");
  if (query)
    return [
      { text: "I'll look across the whole window, not just this workstream." },
      { search: query },
      { text: "Those come from outside this workstream, so they're read-only here." },
    ];
  if (/\b(take|remove)\b.*\bfinished\b/i.test(input.text)) {
    const jira = input.region.items.some((item) => parseItemId(item.id)?.source === "jira");
    if (!jira) return [{ text: "Nothing in this workstream is a story that can be finished." }];
    return [
      { text: "I'll take the finished stories out of this workstream." },
      { run: tidyScript(/\bclose\b/i.test(input.text)) },
      { text: "Oriel lists below what it did." },
    ];
  }
  if (/\b(estimate|estimates|points|unestimated)\b/i.test(input.text)) {
    const jira = input.region.items.some((item) => parseItemId(item.id)?.source === "jira");
    if (!jira)
      return [{ text: "Nothing in this workstream can be estimated: it has no Jira items." }];
    return [
      { text: "I'll find stories here without an estimate and propose 3 points for each." },
      { run: estimateScript },
      {
        text: "If any needed one, the proposed change is below. Nothing is written until you approve it.",
      },
    ];
  }
  return [
    { text: "Here's every item in this workstream, read live." },
    { run: listScript },
    {
      text: "I'm the scripted agent for local development. Ask about estimates to see a change set, or ask me to find something outside the workstream.",
    },
  ];
}
