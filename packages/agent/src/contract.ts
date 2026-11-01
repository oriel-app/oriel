// The interface the server builds the agent against. The lead owns it: change
// it there first.
import type {
  Bindings,
  ChangeSets,
  Instant,
  Log,
  ProxiedRead,
  Region,
  Run,
  RunLimits,
  RunResult,
  Sandbox,
  SearchHit,
  Thread,
  Ulid,
} from "@oriel/core";
import type { Provider } from "./provider.ts";

// One user message in a thread, run to completion.
export type TurnInput = {
  thread: Thread;
  // The version of the thread's workstream this turn uses.
  region: Region;
  // Prior messages, oldest first.
  history: ChatMessage[];
  // The user's message.
  text: string;
  // The index snapshot this turn reads (`indexStore.snapshot(workspaceId)`);
  // each run records it (SPEC §7). Required: a default of 0 would record
  // "never synced".
  snapshot: number;
  // Tokens spent in earlier turns, summed from their `done` events, so
  // `maxTokensPerThread` covers the whole thread. Required: optional would let
  // the cap silently become per-turn.
  spent: { inputTokens: number; outputTokens: number };
};

export type ChatMessage =
  | { role: "user"; text: string; at: Instant }
  | { role: "assistant"; text: string; at: Instant }
  // "added SYN-12", "removed plan.md" (decision 0018).
  | { role: "marker"; text: string; at: Instant }
  // A compact record of a sandbox run, for history. With its script, history
  // replays the run faithfully.
  | { role: "run"; runId: Ulid; summary: string; script?: string; at: Instant };

// What a turn emits, in order. The server persists each and streams it to the
// window. A turn always ends with exactly one `done`, even when aborted, with
// the usage so far. `run.started` comes before the run row exists: the run is
// recorded when it finishes, so persist nothing with a foreign key to `runs`
// until `run.finished`.
export type AgentEvent =
  // Assistant text, possibly in deltas.
  | { kind: "text"; text: string }
  | { kind: "run.started"; runId: Ulid; script: string }
  // Reads and transcript.
  | { kind: "run.finished"; runId: Ulid; result: RunResult }
  // The escape hatch, rendered as its own block (SPEC §1.6).
  | { kind: "search"; runId: Ulid; hits: SearchHit[] }
  // Captured mutations awaiting approval.
  | { kind: "change-set"; changeSetId: Ulid }
  // A per-thread cap that ends the turn: turns or tokens (SPEC §9). A
  // run-level cap (wall time, reads, mutations, output) isn't one: it shows as
  // `run.finished` with that outcome, and the model sees the error and can
  // carry on.
  | { kind: "limit"; reason: string }
  | { kind: "error"; message: string }
  | { kind: "done"; usage: { inputTokens: number; outputTokens: number } };

export interface Agent {
  turn(input: TurnInput, options: { signal: AbortSignal; log: Log }): AsyncIterable<AgentEvent>;
}

export type AgentLimits = {
  // User messages: the history's and this one.
  maxTurnsPerThread: number;
  maxTokensPerThread: number;
  run: RunLimits;
  maxMutationsPerChangeSet: number;
};

// The server builds the agent once at startup.
export type AgentDeps = {
  provider: Provider;
  sandbox: Sandbox;
  // The server wires each source's namespace in.
  bindingsFor: (region: Region) => Bindings;
  // Captured mutations become a change set.
  changeSets: Pick<ChangeSets, "capture">;
  runs: { record(run: Run, reads: ProxiedRead[]): void };
  limits: AgentLimits;
  now: () => Instant;
  newId: () => Ulid;
};
