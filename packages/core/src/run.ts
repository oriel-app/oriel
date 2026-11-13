import type { Instant, Ulid } from "./ids.ts";

// The caller binds `thread_id` and `run_id` before handing a `Log` to anything that runs inside a thread.
export type Log = (message: string, fields?: Record<string, unknown>) => void;

export type RunOutcome = "ok" | "threw" | "timeout" | "limit" | "aborted";

export type Run = {
  id: Ulid;
  workspaceId: Ulid;
  threadId: Ulid;
  snapshot: number;
  regionVersion: number;
  systemPromptHash: string;
  dtsHash: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  wallMs: number;
  coldStartMs: number | null;
  outcome: RunOutcome;
  startedAt: Instant;
};

export type RunRef = Pick<Run, "id" | "threadId" | "workspaceId">;

// No agent ran it, so no agent may revise what it proposed.
export const orielRunModel = "oriel";
