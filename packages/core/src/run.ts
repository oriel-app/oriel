import type { Instant, Ulid } from "./ids.ts";

// Structured log line. The caller binds `thread_id` and `run_id` before
// handing a `Log` to anything that runs inside a thread.
export type Log = (message: string, fields?: Record<string, unknown>) => void;

// How a run ended. "aborted": it was stopped from outside, such as when the
// user cancels the turn.
export type RunOutcome = "ok" | "threw" | "timeout" | "limit" | "aborted";

// One sandbox execution within a thread, recorded so it can be attributed and,
// against fixtures, replayed (SPEC §7).
export type Run = {
  id: Ulid;
  workspaceId: Ulid;
  threadId: Ulid;
  // The source snapshot it read.
  snapshot: number;
  // The version of the thread's workstream it used, start to end (decision 0018).
  regionVersion: number;
  systemPromptHash: string;
  dtsHash: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  wallMs: number;
  // From starting the sandbox to the guest's first line; null when none came.
  coldStartMs: number | null;
  outcome: RunOutcome;
  startedAt: Instant;
};

export type RunRef = Pick<Run, "id" | "threadId" | "workspaceId">;
