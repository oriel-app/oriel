// The agent contract is @oriel/agent's. The server persists each event a
// turn emits and streams it to the window; what comes back from the database
// is checked here on the way out.
import type { AgentDeps, AgentEvent } from "@oriel/agent";
import {
  type ActionLine,
  type ActionName,
  actions,
  array,
  boolean,
  type Call,
  type Intent,
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
  record,
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
// One of Oriel's own actions, as a run recorded it or a line under a reply
// names it; its input is checked again whenever it is dispatched.
const actionName = refine(
  string,
  (name): name is ActionName => Object.hasOwn(actions, name),
  "expected one of Oriel's actions",
);
const intent: Validator<Intent> = object({ action: actionName, input: record(unknown) });
// A run stored before its result had intents recorded none.
const intents: Validator<Intent[]> = (input, path) =>
  input === undefined ? { ok: true, value: [] } : array(intent)(input, path);
export const runResult: Validator<RunResult> = object({
  reads: array(proxiedRead),
  mutations: array(capturedMutation),
  intents,
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

// What the host did with an intent: applied, with its Undo, or refused, and why.
const touched = object({
  kind: union(literal("workstream"), literal("thread")),
  id: nullable(ulidValue),
  name: nullable(string),
});
const actionLine: Validator<ActionLine> = union(
  object({
    call: intent,
    touched,
    applied: literal(true),
    undo: nullable(intent as Validator<unknown> as Validator<Call>),
  }),
  object({ call: intent, touched, applied: literal(false), why: string }),
);

export const agentEvent: Validator<AgentEvent> = union(
  object({ kind: literal("text"), text: string }),
  object({ kind: literal("run.started"), runId: ulidValue, script: string }),
  object({ kind: literal("run.finished"), runId: ulidValue, result: runResult }),
  object({ kind: literal("search"), runId: ulidValue, hits: array(searchHit) }),
  object({ kind: literal("change-set"), changeSetId: ulidValue }),
  object({ kind: literal("actions"), runId: ulidValue, lines: array(actionLine) }),
  object({ kind: literal("limit"), reason: string }),
  object({ kind: literal("error"), message: string }),
  object({
    kind: literal("done"),
    usage: object({ inputTokens: number, outputTokens: number }),
  }),
);
