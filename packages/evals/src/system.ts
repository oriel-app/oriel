// What `pnpm evals` and `evals:ci` run each case through: the agent
// (`@oriel/agent`) answering the case's prompt as one turn of a new thread,
// in the case's world (world.ts), with the real bindings over its region and
// the real sandbox. It reaches the model through the Anthropic provider over
// the round's cassettes, so a live round records and CI replays.
//
// Runs, the change set, the intents and the drafts are kept in memory: every
// intent applies, as the calls the server's dispatcher would get, and every
// draft is held, as the server holds it for the user. The change-set engine itself
// needs the server's database (runs, workstreams and the index); the agent hands
// it the same mutations either way.
import {
  type AgentDeps,
  type AgentEvent,
  type AgentLimits,
  agent,
  anthropicProvider,
  answerOf,
} from "@oriel/agent";
import { bindingsFor } from "@oriel/bindings";
import {
  type CapturedMutation,
  type ChangeSet,
  type Draft,
  type Intent,
  type Instant,
  isItemId,
  type ItemId,
  type MutationRecord,
  type Answered,
  type ChallengeHost,
  challengeAskText,
  type Finding,
  planned,
  type Region,
  readKey,
  type Run,
  type Sandbox,
  type Thread,
  type Ulid,
  ulid,
  type WorkstreamMember,
} from "@oriel/core";
import { createSandbox } from "@oriel/sandbox";
import { checkRecord, keep, written } from "@oriel/server/challenger";
import { itemNamed } from "./fixtures.ts";
import type { SystemInput, SystemUnderTest } from "./runner.ts";
import { buildWorld, caseWorld, member, type World } from "./world.ts";

// The thread's caps (SPEC §9). Generous enough for any case to finish, small
// enough that a case that loops can't run up a large bill.
export const evalLimits: AgentLimits = {
  maxTurnsPerThread: 20,
  maxTokensPerThread: 300_000,
  run: {
    wallMs: 30_000,
    maxScriptBytes: 16_384,
    maxReads: 100,
    maxMutations: 50,
    maxIntents: 20,
    maxResultBytes: 65_536,
    maxConsoleBytes: 16_384,
  },
  maxMutationsPerChangeSet: 50,
};

// The provider's own key, a placeholder: the live transport sets the real one
// on each request, and a replay needs none.
const transportKey = "set-by-the-eval-transport";

export type AgentSystemOptions = {
  // Default: one Deno sandbox for the process, timed by the real clock, which
  // only enforces wall time and never reaches the model.
  sandbox?: () => Sandbox;
  limits?: AgentLimits;
};

let shared: Sandbox | null = null;
const processSandbox = () => (shared ??= createSandbox());

export function agentSystem(options: AgentSystemOptions = {}): SystemUnderTest {
  return async (input) => {
    const world = await buildWorld(caseWorld(input, input.fixtures, input.now));
    try {
      return await turn(world, input, options);
    } finally {
      world.close();
    }
  };
}

export const system: SystemUnderTest = agentSystem();

async function turn(world: World, input: SystemInput, options: AgentSystemOptions) {
  const newId = counter(input.now);
  const records = memoryRecords(newId, input.now, world.region, (id) => member(input.fixtures, id));
  const answered = new Map<string, Answered>();
  // Every sketch() call, shown or refused.
  let sketches = 0;
  const { region } = world;
  const thread: Thread = {
    id: newId(),
    workspaceId: region.workspaceId,
    workstreamId: region.workstreamId,
    regionVersion: region.version,
    state: "working",
    doneBy: null,
    createdAt: input.now,
  };
  const deps: AgentDeps = {
    provider: anthropicProvider({ apiKey: transportKey, model: input.model, fetch: input.fetch }),
    sandbox: (options.sandbox ?? processSandbox)(),
    bindingsFor: (r, threadId, shown, run) => {
      const bindings = bindingsFor(r, {
        reader: world.reader,
        namespaces: world.namespaces,
        items: world.items,
        oriel: world.oriel,
        thread: threadId,
        ...(shown ? { shown } : {}),
        ...(world.overview ? { overview: world.overview } : {}),
        ...(world.waiting ? { waiting: world.waiting } : {}),
        history: world.history,
        ...(run?.challenge ? { challenge: run.challenge } : {}),
        ...(run?.revise ? { revise: run.revise } : {}),
      });
      // What each read answered, so the blocks grader can build each block
      // again from its read.
      return {
        ...bindings,
        read: async (fn, args) => {
          const answer = await bindings.read(fn, args);
          if (fn === "sketch") sketches += 1;
          if (fn !== "show" && fn !== "sketch")
            answered.set(readKey(fn, args), answerOf(bindings, fn, answer));
          return answer;
        },
      };
    },
    runs: records.runs,
    changeSets: records.changeSets,
    actions: records.actions,
    drafts: records.drafts,
    limits: options.limits ?? evalLimits,
    now: () => input.now,
    newId,
  };
  // A second look (kind 9): the case's diff, and what each run recorded, as
  // the server checks it.
  const look = secondLook(input, region, world);
  const events: AgentEvent[] = [];
  for await (const event of agent(deps).turn(
    {
      thread,
      region,
      history: (input.case.before ?? []).map((said) => ({ ...said, at: input.now })),
      text: look ? challengeAskText : (input.case.prompt ?? ""),
      snapshot: 1,
      spent: { inputTokens: 0, outputTokens: 0 },
      ...(look ? { challenge: look.host } : {}),
    },
    { signal: new AbortController().signal, log: () => {} },
  ))
    events.push(event);
  // A turn the agent couldn't finish is the system's error, not a grade.
  const ended = events.find((e) => e.kind === "error" || e.kind === "limit");
  if (ended?.kind === "error") throw new Error(`the agent's turn failed: ${ended.message}`);
  if (ended?.kind === "limit") throw new Error(`the agent hit a limit: ${ended.reason}`);
  if (look) {
    const results = new Map(
      events.flatMap((e) => (e.kind === "run.finished" ? [[e.runId, e.result] as const] : [])),
    );
    const kept = keep(results, look.recorded);
    return {
      // What a companion would add, as the person would add it.
      mutations: kept?.companions ?? [],
      look: { kept: kept !== null, findings: kept?.findings ?? [] },
      reply: replyOf(events),
      transcript: events,
    };
  }
  return {
    mutations: records.captured(),
    intents: records.applied(),
    drafts: records.held(),
    blocks: events.flatMap((event) =>
      event.kind === "block"
        ? [
            {
              block: event.block,
              answered: answered.get(readKey(event.block.spec.read, event.block.spec.args)) ?? null,
            },
          ]
        : [],
    ),
    sketches,
    refusedBlocks: events.filter((event) => event.kind === "block.refused").length,
    reply: replyOf(events),
    transcript: events,
  };
}

// A second look's host over the case's diff, with what each run recorded,
// checked as the server checks it; null for any other case.
function secondLook(input: SystemInput, region: Region, world: World) {
  const challenge = input.case.challenge;
  if (!challenge) return null;
  const lines = challenge.lines.map((line, i) => {
    const named = line.item === null ? null : itemNamed(input.fixtures, line.item);
    if (named && "problem" in named) throw new Error(named.problem);
    return { n: i + 1, change: line.change, item: named?.id ?? null, fields: line.fields };
  });
  const members = new Set<string>(region.items.map((item) => item.id));
  const recorded = new Map<Ulid, Finding[]>();
  const host: ChallengeHost = {
    diff: async () => lines,
    record: async (runId, findings) => {
      const checked = await checkRecord(findings, {
        lines: lines.map(written),
        members,
        read: world.reader.read,
      });
      if (checked.findings) recorded.set(runId, checked.findings);
      return checked.answer;
    },
  };
  return { host, recorded };
}

// What the user sees: the agent's text, a paragraph break wherever a run
// came between.
export function replyOf(events: readonly AgentEvent[]): string {
  let reply = "";
  let between = false;
  for (const event of events) {
    if (event.kind !== "text") {
      between = true;
      continue;
    }
    if (between && reply) reply += "\n\n";
    reply += event.text;
    between = false;
  }
  return reply;
}

// IDs that sort in the order they were made, from the eval clock.
function counter(now: Instant): () => Ulid {
  let n = 0;
  return () => {
    n += 1;
    const random = new Uint8Array(10);
    new DataView(random.buffer).setUint32(6, n);
    return ulid(Date.parse(now), random);
  };
}

// Runs and change sets in memory. As the change-set engine does, a capture
// needs its run recorded first. The thread's region gains what the calls
// applied so far add to its workstream, as the server's would (OA-312).
function memoryRecords(
  newId: () => Ulid,
  now: Instant,
  base: Region,
  memberOf: (id: ItemId) => WorkstreamMember,
) {
  const runs = new Set<Ulid>();
  const sets: CapturedMutation[][] = [];
  const made = new Map<string, ChangeSet>();
  const calls: Intent[] = [];
  const held: Draft[] = [];
  const recorder: Pick<AgentDeps, "runs" | "changeSets" | "actions" | "drafts"> = {
    drafts: { hold: (_thread, drafts) => void held.push(...drafts) },
    actions: {
      async apply(turn, intents) {
        const applied = planned(intents, { thread: turn.thread.id });
        calls.push(...applied);
        return applied.map((call) => ({
          call,
          touched: { kind: "workstream" as const, id: null, name: null },
          applied: true as const,
          undo: null,
        }));
      },
      region: () => {
        const items = [...base.items];
        for (const call of calls) {
          const { workstream, items: named } = call.input;
          if (call.action !== "workstream.add" || workstream !== base.workstreamId) continue;
          for (const id of Array.isArray(named) ? named : [])
            if (typeof id === "string" && isItemId(id) && !items.some((m) => m.id === id))
              items.push(memberOf(id));
        }
        const grew = items.length > base.items.length;
        return grew ? { ...base, version: base.version + 1, items } : base;
      },
    },
    runs: { record: (run: Run) => void runs.add(run.id) },
    changeSets: {
      async capture(ref, mutations) {
        if (!runs.has(ref.id)) throw new Error(`no run ${ref.id}`);
        const id = newId();
        sets.push([...mutations]);
        const records = mutations.map((m, i): MutationRecord => ({
          id: newId(),
          changeSetId: id,
          seq: i + 1,
          op: m.op,
          target: m.target,
          ref: m.ref,
          args: m.args,
          preview: null,
          status: "pending",
          applied: null,
          error: null,
          reverts: null,
          version: 0,
        }));
        const changeSet: ChangeSet = {
          id,
          workspaceId: ref.workspaceId,
          threadId: ref.threadId,
          runId: ref.id,
          mutations: records,
          hash: "",
          decision: null,
          revertOf: null,
          createdAt: now,
          completedAt: null,
          revisedAt: null,
        };
        made.set(id, changeSet);
        return changeSet;
      },
      async revisable(id, threadId) {
        return made.get(id)?.threadId === threadId ? null : "not this thread's";
      },
      // A revision is graded as the turn's change set, as a capture is.
      async revise(id, ref, mutations) {
        const before = made.get(id);
        if (!before || !runs.has(ref.id)) throw new Error(`no change set ${id}`);
        sets.push([...mutations]);
        const changeSet: ChangeSet = { ...before, runId: ref.id, revisedAt: now };
        made.set(id, changeSet);
        return changeSet;
      },
    },
  };
  // The turn's change set: a turn captures at most one.
  return {
    ...recorder,
    captured: () => sets.at(-1) ?? [],
    applied: () => [...calls],
    held: () => [...held],
  };
}
