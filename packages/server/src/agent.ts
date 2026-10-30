// The agent contract, as @oriel/agent exports it. The server builds against
// this copy until that package lands; wiring it in turns this file into a
// re-export. The server persists each event a turn emits and streams it to
// the window.
import {
  array,
  boolean,
  type Bindings,
  type ChangeSets,
  type Instant,
  isInstant,
  isItemId,
  isNewRef,
  isUlid,
  type ItemId,
  literal,
  type Log,
  type NewRef,
  nullable,
  number,
  object,
  optional,
  type ProxiedRead,
  refine,
  type Region,
  type Run,
  type RunLimits,
  type RunResult,
  type Sandbox,
  type SearchHit,
  string,
  type Thread,
  type Ulid,
  union,
  unknown,
  type Validator,
} from "@oriel/core";

// One user message in a thread, run to completion.
export type TurnInput = {
  thread: Thread;
  // The version of the thread's group this turn uses, start to end.
  region: Region;
  // Prior messages, oldest first.
  history: ChatMessage[];
  // The user's message.
  text: string;
  // The index snapshot the turn reads, which its runs record.
  snapshot: number;
  // Tokens earlier turns spent, summed from their `done` events, so the
  // thread's token cap covers the whole thread.
  spent: { inputTokens: number; outputTokens: number };
};

export type ChatMessage =
  | { role: "user"; text: string; at: Instant }
  | { role: "assistant"; text: string; at: Instant }
  // "added jira:SYN-12" (decision 0018). IDs only: a title is source content.
  | { role: "marker"; text: string; at: Instant }
  // A compact record of a sandbox run, for history, with its script.
  | { role: "run"; runId: Ulid; summary: string; script?: string; at: Instant };

// What a turn emits, in order.
export type AgentEvent =
  // Assistant text, possibly in deltas.
  | { kind: "text"; text: string }
  | { kind: "run.started"; runId: Ulid; script: string }
  | { kind: "run.finished"; runId: Ulid; result: RunResult }
  // The escape hatch, rendered as its own block (SPEC §1.6).
  | { kind: "search"; runId: Ulid; hits: SearchHit[] }
  // Captured mutations awaiting approval.
  | { kind: "change-set"; changeSetId: Ulid }
  // A per-thread cap (turns or tokens) ended the turn (SPEC §9). A run-level
  // cap arrives as a run.finished whose outcome is "limit", and the turn goes on.
  | { kind: "limit"; reason: string }
  | { kind: "error"; message: string }
  | { kind: "done"; usage: { inputTokens: number; outputTokens: number } };

// A turn always ends with exactly one `done`, even when aborted. A run is
// recorded when it finishes, so nothing keyed to it exists at `run.started`.
export interface Agent {
  turn(input: TurnInput, options: { signal: AbortSignal; log: Log }): AsyncIterable<AgentEvent>;
}

export type AgentLimits = {
  maxTurnsPerThread: number;
  maxTokensPerThread: number;
  run: RunLimits;
  maxMutationsPerChangeSet: number;
};

// What the server builds an agent from, but the provider, which comes with
// @oriel/agent.
export type AgentDeps = {
  sandbox: Sandbox;
  bindingsFor: (region: Region) => Bindings;
  changeSets: Pick<ChangeSets, "capture">;
  runs: { record(run: Run, reads: ProxiedRead[]): void };
  limits: AgentLimits;
  now: () => Instant;
  newId: () => Ulid;
};

// Events come back from the database, so they are checked on the way out.
// A run's result is checked as far as the window renders it.
const ulidValue = refine(string, isUlid, "expected a ULID");
const runError = object({
  phase: union(literal("typecheck"), literal("runtime"), literal("limit")),
  message: string,
  hint: optional(string),
  logs: array(string),
});
const transcriptEntry = union(
  object({ kind: literal("log"), text: string }),
  object({ kind: literal("return"), value: unknown }),
  object({ kind: literal("error"), error: runError }),
);
const proxiedRead = object({
  fn: string,
  args: array(unknown),
  ms: number,
  status: union(literal("answered"), literal("failed"), literal("unanswered")),
  outsideRegion: nullable(boolean),
  payloadHash: nullable(string),
});
const newRef = refine(string, isNewRef, "expected a new:N ref");
const capturedMutation = object({
  op: string,
  target: nullable(
    refine(
      string,
      (value): value is ItemId | NewRef => isItemId(value) || isNewRef(value),
      "expected an item ID or a new:N ref",
    ),
  ),
  ref: nullable(newRef),
  args: unknown,
});
export const runResult: Validator<RunResult> = object({
  reads: array(proxiedRead),
  mutations: array(capturedMutation),
  transcript: array(transcriptEntry),
  outcome: union(literal("ok"), literal("threw"), literal("timeout"), literal("limit")),
  wallMs: number,
  coldStartMs: nullable(number),
});
export const searchHit: Validator<SearchHit> = object({
  id: refine(string, isItemId, "expected an item ID"),
  title: string,
  location: string,
  updatedAt: refine(string, isInstant, "expected an instant"),
});

export const agentEvent: Validator<AgentEvent> = union(
  object({ kind: literal("text"), text: string }),
  object({ kind: literal("run.started"), runId: ulidValue, script: string }),
  object({ kind: literal("run.finished"), runId: ulidValue, result: runResult }),
  object({ kind: literal("search"), runId: ulidValue, hits: array(searchHit) }),
  object({ kind: literal("change-set"), changeSetId: ulidValue }),
  object({ kind: literal("limit"), reason: string }),
  object({ kind: literal("error"), message: string }),
  object({
    kind: literal("done"),
    usage: object({ inputTokens: number, outputTokens: number }),
  }),
);
