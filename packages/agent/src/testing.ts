// Test support: the SYN fixture as regions with real bindings, a provider
// that plays scripted model responses, in-memory run and change-set records,
// and a fixed clock and IDs. Every test builds its own with `harness()`.
import { bindingsFor, type Namespaces } from "@oriel/bindings";
import {
  type CapturedMutation,
  type ChangeSet,
  type Instant,
  instant,
  type ItemId,
  type MutationRecord,
  parseItemId,
  type ProxiedRead,
  type Reader,
  type ReadResult,
  type Region,
  type Run,
  type RunLimits,
  type Sandbox,
  type Thread,
  type Ulid,
  ulid,
} from "@oriel/core";
import { fixtureSnapshot, jiraNamespace } from "@oriel/jira";
import { createSandbox } from "@oriel/sandbox";
import { loadJiraFixture } from "../../../scripts/fixtures/load.ts";
import type { AgentDeps, AgentEvent, AgentLimits, TurnInput } from "./contract.ts";
import { agent } from "./loop.ts";
import {
  type ConversationRequest,
  type Provider,
  type Stop,
  type ToolResult,
  type Usage,
} from "./provider.ts";

export const t0 = instant(new Date(Date.UTC(2026, 9, 29, 9, 0, 0)));

const fixture = loadJiraFixture();
const site = "https://oriel.atlassian.net";
const snapshot = fixtureSnapshot(fixture, site, 0);

const namespaces: Namespaces = {
  jira: jiraNamespace(new Map(snapshot.records.map((record) => [record.id, record.facets.kind]))),
};

// The SYN project as the fixture's base state has it, read live.
const reader: Reader = {
  read: async (ids) =>
    ids.map((id): ReadResult => {
      const content =
        parseItemId(id)?.source === "jira" ? snapshot.content.get(id as ItemId<"jira">) : undefined;
      return content ? { id, status: "ok", content } : { id, status: "gone", reason: "deleted" };
    }),
  search: async (query, limit) => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return snapshot.records
      .filter((r) => terms.every((term) => `${r.id} ${r.title}`.toLowerCase().includes(term)))
      .slice(0, limit);
  },
};

// IDs that sort in the order they were made.
export function counter(): () => Ulid {
  let n = 0;
  return () => {
    n += 1;
    const random = new Uint8Array(10);
    random[9] = n % 256;
    random[8] = Math.floor(n / 256);
    return ulid(Date.parse(t0), random);
  };
}

const fixedId = counter()();

export const thread: Thread = {
  id: fixedId,
  workspaceId: fixedId,
  groupId: fixedId,
  regionVersion: 1,
  state: "working",
  doneBy: null,
  createdAt: t0,
};

// A frozen fixture region as version 1 of the thread's group.
export function fixtureRegion(name: string): Region {
  const frozen = fixture.regions.find((region) => region.name === name);
  if (!frozen) throw new RangeError(`no fixture region ${name}`);
  const stableIds = new Map(fixture.issues.map((issue) => [`jira:${issue.key}`, issue.id]));
  return {
    groupId: thread.groupId,
    version: 1,
    workspaceId: thread.workspaceId,
    items: frozen.items.map((id) => ({ id, stableId: stableIds.get(id) ?? "" })),
    origin: frozen.origin,
  };
}

export const regionBindings = (region: Region) => bindingsFor(region, { reader, namespaces });

export const runLimits: RunLimits = {
  wallMs: 60_000,
  maxScriptBytes: 16_384,
  maxReads: 50,
  maxMutations: 20,
  maxResultBytes: 65_536,
  maxConsoleBytes: 16_384,
};

export const limits: AgentLimits = {
  maxTurnsPerThread: 20,
  maxTokensPerThread: 1_000_000,
  run: runLimits,
  maxMutationsPerChangeSet: 20,
};

// One scripted model response: text in deltas, then calls (each a script for
// `run`, or any tool name and input), then the stop. `before` runs when the
// response is asked for, with the results the loop sent.
export type Step = {
  text?: string[];
  scripts?: string[];
  calls?: { name: string; input: unknown }[];
  stop?: Stop;
  detail?: string;
  usage?: Partial<Usage>;
  before?: (results: readonly ToolResult[]) => void;
};

export const tokens = (inputTokens: number, outputTokens: number): Usage => ({
  inputTokens,
  outputTokens,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

// Plays `steps` in order across every conversation, and keeps what each
// conversation was asked: its request, and the results sent with each
// response (none with the first). It honours the abort signal as a stream
// would.
export function scriptedProvider(steps: Step[]) {
  const queue = [...steps];
  const conversations: { request: ConversationRequest; results: ToolResult[][] }[] = [];
  let calls = 0;
  const provider: Provider = {
    converse(request) {
      const conversation = { request, results: [] as ToolResult[][] };
      conversations.push(conversation);
      return {
        async *next(results) {
          const { signal } = request;
          signal.throwIfAborted();
          conversation.results.push([...results]);
          const step = queue.shift();
          if (!step) throw new Error("the model has no more scripted responses");
          step.before?.(results);
          for (const text of step.text ?? []) {
            signal.throwIfAborted();
            yield { kind: "text", text };
          }
          const made = [
            ...(step.scripts ?? []).map((script) => ({ name: "run", input: { script } })),
            ...(step.calls ?? []),
          ];
          for (const call of made) {
            calls += 1;
            yield { kind: "call", call: { id: `call_${calls}`, ...call } };
          }
          signal.throwIfAborted();
          yield {
            kind: "end",
            stop: step.stop ?? (made.length ? "calls" : "done"),
            detail: step.detail ?? null,
            model: "scripted-model",
            usage: { ...tokens(100, 10), ...step.usage },
          };
        },
      };
    },
  };
  return { provider, conversations, unplayed: () => queue.length };
}

// Runs and change sets in memory. As the real change-set engine does, a
// capture needs its run recorded first.
export function memoryRecords(newId: () => Ulid) {
  const runs: { run: Run; reads: ProxiedRead[] }[] = [];
  const changeSets: { changeSet: ChangeSet; mutations: CapturedMutation[] }[] = [];
  const deps: Pick<AgentDeps, "runs" | "changeSets"> = {
    runs: { record: (run, reads) => void runs.push({ run, reads }) },
    changeSets: {
      async capture(ref, mutations) {
        if (!runs.some(({ run }) => run.id === ref.id)) throw new Error(`no run ${ref.id}`);
        const id = newId();
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
          createdAt: t0,
        };
        changeSets.push({ changeSet, mutations: [...mutations] });
        return changeSet;
      },
    },
  };
  return { runs, changeSets, deps };
}

// Time is passed in: every sandbox duration comes out as 0.
let shared: Sandbox | null = null;
export const sandbox = (): Sandbox => (shared ??= createSandbox({ now: () => 0 }));

export type Logged = { message: string; fields: Record<string, unknown> };

// An agent over the real sandbox and the SYN fixture, with a scripted model.
export function harness(
  steps: Step[],
  options: { limits?: Partial<AgentLimits>; bindings?: AgentDeps["bindingsFor"] } = {},
) {
  const newId = counter();
  const model = scriptedProvider(steps);
  const records = memoryRecords(newId);
  const deps: AgentDeps = {
    provider: model.provider,
    sandbox: sandbox(),
    bindingsFor: options.bindings ?? regionBindings,
    ...records.deps,
    limits: { ...limits, ...options.limits },
    now: (): Instant => t0,
    newId,
  };
  const logged: Logged[] = [];
  // Collects the turn's events. `onEvent` and `onLog` see each as it comes,
  // with the turn's controller, so a test can abort at a given point.
  const turn = async (
    input: Partial<TurnInput> & { region: Region },
    hooks: {
      onEvent?: (event: AgentEvent, controller: AbortController) => void;
      onLog?: (line: Logged, controller: AbortController) => void;
    } = {},
  ) => {
    const controller = new AbortController();
    const events: AgentEvent[] = [];
    const log = (message: string, fields: Record<string, unknown> = {}) => {
      logged.push({ message, fields });
      hooks.onLog?.({ message, fields }, controller);
    };
    for await (const event of agent(deps).turn(
      { thread, history: [], text: "Which stories have no estimate?", ...input },
      { signal: controller.signal, log },
    )) {
      events.push(event);
      hooks.onEvent?.(event, controller);
    }
    return events;
  };
  return { deps, model, records, logged, turn };
}

// What a run returned, from its `run.finished` event.
export function returned(events: AgentEvent[], runIndex = 0): unknown {
  const finished = events.filter((e) => e.kind === "run.finished")[runIndex];
  const last = finished?.result.transcript.at(-1);
  return last?.kind === "return" ? last.value : last;
}

export const kinds = (events: AgentEvent[]) => events.map((event) => event.kind);
