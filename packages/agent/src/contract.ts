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
  // The version of the thread's group this turn uses.
  region: Region;
  // Prior messages, oldest first.
  history: ChatMessage[];
  // The user's message.
  text: string;
  // Not in the lead's contract yet; both are optional so the server compiles
  // without them. The index snapshot this turn's runs read against, which each
  // run records (SPEC §7); 0 when not given.
  snapshot?: number;
  // What the thread's earlier turns used, from their `done` events. The
  // per-thread token cap counts it with this turn's usage; without it, the cap
  // can only count this turn.
  spent?: { inputTokens: number; outputTokens: number };
};

export type ChatMessage =
  | { role: "user"; text: string; at: Instant }
  | { role: "assistant"; text: string; at: Instant }
  // "added SYN-12", "removed plan.md" (decision 0018).
  | { role: "marker"; text: string; at: Instant }
  // A compact record of a sandbox run, for history.
  | { role: "run"; runId: Ulid; summary: string; at: Instant };

// What a turn emits, in order. The server persists each and streams it to the
// window. Every turn ends with exactly one `done`, however it ends.
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
  // A cap hit (SPEC §9).
  | { kind: "limit"; reason: string }
  | { kind: "error"; message: string }
  | { kind: "done"; usage: { inputTokens: number; outputTokens: number } };

export interface Agent {
  turn(input: TurnInput, options: { signal: AbortSignal; log: Log }): AsyncIterable<AgentEvent>;
}

export type AgentLimits = {
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
