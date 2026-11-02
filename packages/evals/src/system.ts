// What `pnpm evals` and `evals:ci` run each case through: the agent
// (`@oriel/agent`) answering the case's prompt as one turn of a new thread,
// in the case's world (world.ts), with the real bindings over its region and
// the real sandbox. It reaches the model through the Anthropic provider over
// the round's cassettes, so a live round records and CI replays.
//
// Runs and the change set are kept in memory. The change-set engine itself
// needs the server's database (runs, workstreams and the index); the agent hands
// it the same mutations either way.
import {
  type AgentDeps,
  type AgentEvent,
  type AgentLimits,
  agent,
  anthropicProvider,
} from "@oriel/agent";
import { bindingsFor } from "@oriel/bindings";
import {
  type CapturedMutation,
  type ChangeSet,
  type Instant,
  type MutationRecord,
  type Run,
  type Sandbox,
  type Thread,
  type Ulid,
  ulid,
} from "@oriel/core";
import { createSandbox } from "@oriel/sandbox";
import type { SystemInput, SystemUnderTest } from "./runner.ts";
import { buildWorld, type World } from "./world.ts";

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
    const world = await buildWorld({
      fixture: input.fixture,
      folder: input.folder,
      region: input.region,
      files: input.case.files ?? [],
      messages: input.case.messages ?? [],
      ...(input.slack ? { slack: input.slack } : {}),
      edited: input.case.edited ?? 0,
      folderEdited: input.case.folderEdited ?? 0,
      ...(input.case.oriel ? { oriel: input.case.oriel } : {}),
    });
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
  const records = memoryRecords(newId, input.now);
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
    bindingsFor: (r) =>
      bindingsFor(r, {
        reader: world.reader,
        namespaces: world.namespaces,
        items: world.items,
        oriel: world.oriel,
      }),
    runs: records.runs,
    changeSets: records.changeSets,
    limits: options.limits ?? evalLimits,
    now: () => input.now,
    newId,
  };
  const events: AgentEvent[] = [];
  for await (const event of agent(deps).turn(
    {
      thread,
      region,
      history: [],
      text: input.case.prompt,
      snapshot: 1,
      spent: { inputTokens: 0, outputTokens: 0 },
    },
    { signal: new AbortController().signal, log: () => {} },
  ))
    events.push(event);
  // A turn the agent couldn't finish is the system's error, not a grade.
  const ended = events.find((e) => e.kind === "error" || e.kind === "limit");
  if (ended?.kind === "error") throw new Error(`the agent's turn failed: ${ended.message}`);
  if (ended?.kind === "limit") throw new Error(`the agent hit a limit: ${ended.reason}`);
  return { mutations: records.captured(), reply: replyOf(events), transcript: events };
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
// needs its run recorded first.
function memoryRecords(newId: () => Ulid, now: Instant) {
  const runs = new Set<Ulid>();
  const sets: CapturedMutation[][] = [];
  const recorder: Pick<AgentDeps, "runs" | "changeSets"> = {
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
        };
        return changeSet;
      },
    },
  };
  // The turn's change set: a turn captures at most one.
  return { ...recorder, captured: () => sets.at(-1) ?? [] };
}
