// A scripted stand-in for the agent, for tests and for `pnpm dev` until
// @oriel/agent is wired in. It speaks the same contract and uses the same
// deps. A turn follows a plan instead of a model, but its runs are real: the
// sandbox runs each script against the region's bindings, and the run is
// recorded. What the last run to capture writes captured becomes the change
// set, and the last run's intents apply, as for any agent (`proposal`); the
// blocks and sketches its runs ask for show under its reply, as for any
// agent (`turnShown`).
import { createHash } from "node:crypto";
import { proposal, turnShown } from "@oriel/agent";
import { type Log, parseItemId, type RunResult, type ThreadFound } from "@oriel/core";
import { type Agent, type ServerAgentDeps, type AgentEvent, type TurnInput } from "./agent.ts";

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
  const { choices } = deps;
  const turnShows = turnShown(
    deps.newId,
    input.choices && choices ? (ask) => choices.check(ask, region) : undefined,
  );
  const options = { choices: input.choices === true };
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
    const shown = turnShows.run(runId, (asked) =>
      deps.bindingsFor(region, thread.id, asked, options),
    );
    const { bindings } = shown;
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
    yield* shown.ran(result);
    // A model reads a failed run and answers from it; the rest of the plan
    // assumed the run worked, so the turn ends here, saying why, with what
    // earlier runs proposed.
    const failed = result.transcript.findLast((e) => e.kind === "error");
    if (result.outcome !== "ok" && failed?.kind === "error") {
      yield { kind: "text", text: `Nothing to propose: ${failed.error.message}.` };
      break;
    }
    if ("threads" in step) yield { kind: "text", text: chipTo(returned(result)) };
    proposed.ran(runId, result);
  }
  yield* turnShows.settle();
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

// Takes out of the workstream what Jira no longer has.
const prune = `const stories = await jira.listItems();
const gone = stories.flatMap((story) => (story.gone ? [story.id] : []));
if (gone.length) workstream.remove({ items: gone });
return gone;`;

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

// A reply naming the first thing thread.find() returned as a chip, as the
// agent's would (decision 0032).
function chipTo(found: unknown): string {
  const [first] = Array.isArray(found) ? found : [];
  const hit = typeof first === "object" && first !== null ? (first as Partial<ThreadFound>) : {};
  const { thread, changeSet } = hit;
  if (!thread) return "I couldn't find that in any thread.";
  return changeSet
    ? `It was [[${changeSet.id}]], in [[${thread.id}]].`
    : `It was in [[${thread.id}]].`;
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

// The synthetic fare-policy conversation in the Slack fixture, and its
// story, which the scripted agent finds a choice in (the decision-desk
// spike); each quote is copied from the fixture.
const fareConversation = "slack:C0FW1WEATHR-1788444000.000100";
const fareStory = "jira:SYN-45";
export const fareChoice = {
  question: "Do passengers keep their fare on next-day sailings after a weather cancellation?",
  options: [
    {
      label: "Same day only: the fare holds on later sailings that day; next day case by case",
      standing: "agreed",
      evidence: [
        {
          id: fareConversation,
          quote:
            "passengers keep the fare they paid on any later sailing that day, even a dearer one",
          role: "proposes",
        },
        {
          id: fareConversation,
          quote: "Next-day sailings are case by case for now.",
          role: "proposes",
        },
        {
          id: fareConversation,
          quote: "Yes, supplements carry over too. Same fare, same supplements.",
          role: "amends",
        },
      ],
    },
    {
      label: "Next day too: the fare holds on the next day's sailings",
      standing: "proposed",
      evidence: [
        {
          id: fareConversation,
          quote: "ops agreed that next-day sailings now follow the same rule",
          role: "amends",
        },
        { id: fareConversation, quote: "I've updated SYN-45.", role: "proposes" },
        {
          id: fareStory,
          quote:
            "if we cancel, the passenger keeps the fare they paid, even when the next sailing is in a dearer fare band",
          role: "proposes",
        },
      ],
    },
  ],
  open: [
    "Only Farid says ops agreed to next-day sailings; neither Dara nor anyone from ops says so in the conversation.",
    "SYN-45 last changed before Farid said he updated it, and its acceptance criteria name no day.",
  ],
};

const choiceScript = `await items.read(${JSON.stringify(fareConversation)});
await items.read(${JSON.stringify(fareStory)});
return await choices.add(${JSON.stringify(fareChoice, null, 2)});`;

const carryScript = (option: number) => {
  const sameDay = option === 0;
  const rule = sameDay
    ? "keeps the fare they paid on any later sailing that day, even when it is in a dearer fare band. Next-day sailings are case by case"
    : "keeps the fare they paid on any later sailing that day and on the next day's sailings, even when that sailing is in a dearer fare band";
  const description = `Policy from operations: if we cancel a sailing for weather, the passenger ${rule}. Vehicle supplements carry over. We absorb the difference; we never charge it.\n\nAcceptance criteria:\n- The rebooked fare equals the original fare${sameDay ? " on the same day" : ", the same day or the next"}\n- Supplements carry over\n- The receipt says 'Fare difference waived'`;
  const said = sameDay
    ? "Decided: after a weather cancellation, passengers keep their fare on later sailings the same day, supplements included. Next-day sailings stay case by case. SYN-45 says so now."
    : "Decided: after a weather cancellation, passengers keep their fare on later sailings the same day and the next day, supplements included. SYN-45 says so now.";
  return `jira.setDescription(${JSON.stringify(fareStory)}, ${JSON.stringify(description)});
slack.reply(${JSON.stringify(fareConversation)}, ${JSON.stringify(said)});
return "proposed";`;
};

const askScript = `slack.reply(${JSON.stringify(fareConversation)}, ${JSON.stringify(
  "Before we build SYN-45: did ops agree that next-day sailings keep the fare too? The decision above says next day is case by case, and only the later reply says ops agreed.",
)});
return "proposed";`;

// A run Oriel started to find choices, or one carrying out what the user
// did with one, as Oriel's last line in the history says.
function choicePlan(input: TurnInput): Step[] | null {
  const holds = input.region.items.some((item) => item.id === fareConversation);
  if (input.choices)
    return holds
      ? [
          { text: "I read the workstream's conversations and stories for choices still open." },
          { run: choiceScript },
          {
            text: "One choice is still open: whether the fare holds on next-day sailings. The later reply says ops agreed, but nobody from ops or the person who made the first decision says so.",
          },
        ]
      : [
          { text: "I read every item here." },
          { run: listScript },
          { text: "I found no choice the items discuss and leave open." },
        ];
  const last = input.history.findLast((m) => m.role === "note");
  if (last?.role !== "note" || last.note.kind !== "choice" || !holds) return null;
  if (last.note.outcome === "chosen")
    return [
      { text: "I'll write the choice into the story and tell the conversation." },
      { run: carryScript(last.note.option ?? 0) },
      { text: "The proposed changes are below. Nothing is written or posted until you approve." },
    ];
  if (last.note.outcome === "asked")
    return [
      { text: "I'll ask in the conversation what's still unanswered." },
      { run: askScript },
      { text: "The reply is below for you to review. Nothing is posted until you approve." },
    ];
  return null;
}

// What `pnpm dev` answers with: a link to a thread when asked where
// something happened, a search when asked to find something, an estimate
// change when asked about estimates, the finished stories taken out of the
// workstream when asked to (and the thread closed, if asked), a Slack post
// or reply when asked to "post: …" or "reply: …", and otherwise a read of
// every item in the region.
export function devPlan(input: TurnInput): Step[] {
  const chose = choicePlan(input);
  if (chose) return chose;
  if (threadsAsk.test(input.text))
    return [
      { text: "I'll look through your threads." },
      { threads: input.text.replace(/[?.!"]+/g, " ").trim() },
    ];
  const slackAsked = slackAsk.exec(input.text);
  if (slackAsked) {
    const fn = slackAsked[1]?.toLowerCase() === "reply" ? "reply" : "postMessage";
    const slack = input.region.items.some((item) => parseItemId(item.id)?.kind === "slack");
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
  if (/\b(take|remove)\b.*\bdeleted\b/i.test(input.text))
    return [{ text: "I'll take what was deleted in Jira out of this workstream." }, { run: prune }];
  if (/\b(take|remove)\b.*\bfinished\b/i.test(input.text)) {
    const jira = input.region.items.some((item) => parseItemId(item.id)?.kind === "jira");
    if (!jira) return [{ text: "Nothing in this workstream is a story that can be finished." }];
    return [
      { text: "I'll take the finished stories out of this workstream." },
      { run: tidyScript(/\bclose\b/i.test(input.text)) },
    ];
  }
  if (/\b(estimate|estimates|points|unestimated)\b/i.test(input.text)) {
    const jira = input.region.items.some((item) => parseItemId(item.id)?.kind === "jira");
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
