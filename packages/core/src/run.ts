import type { Instant, Ulid } from "./ids.ts";

// Structured log line. The caller binds `thread_id` and `run_id` before
// handing a `Log` to anything that runs inside a thread.
export type Log = (message: string, fields?: Record<string, unknown>) => void;

// One sandbox execution within a thread, recorded so it can be attributed and,
// against fixtures, replayed (SPEC §7).
export type Run = {
  id: Ulid;
  workspaceId: Ulid;
  threadId: Ulid;
  snapshot: number;
  systemPromptHash: string;
  dtsHash: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  wallMs: number;
  outcome: "ok" | "threw" | "timeout" | "limit";
  startedAt: Instant;
};

export type RunRef = Pick<Run, "id" | "threadId" | "workspaceId">;
