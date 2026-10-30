// The agent contract is @oriel/agent's. The server persists each event a
// turn emits and streams it to the window; what comes back from the database
// is checked here on the way out.
import type { AgentDeps, AgentEvent } from "@oriel/agent";
import {
  array,
  boolean,
  isInstant,
  isItemId,
  isNewRef,
  isUlid,
  type ItemId,
  literal,
  type NewRef,
  nullable,
  number,
  object,
  optional,
  refine,
  type RunResult,
  type SearchHit,
  string,
  union,
  unknown,
  type Validator,
} from "@oriel/core";

export type {
  Agent,
  AgentDeps,
  AgentEvent,
  AgentLimits,
  ChatMessage,
  TurnInput,
} from "@oriel/agent";

// What the server builds an agent from: everything but the provider, which
// only the model-backed agent has.
export type ServerAgentDeps = Omit<AgentDeps, "provider">;

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
