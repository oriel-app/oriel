import type { ActionName } from "./actions.ts";
import type { ItemId, SourceKind } from "./ids.ts";
import type { Log, RunOutcome } from "./run.ts";
import type { SearchHit } from "./source.ts";
import type { PreviewTable, ResultFields } from "./block.ts";
import {
  array,
  type Infer,
  literal,
  nullable,
  number,
  object,
  refine,
  string,
  union,
  unknown,
} from "./validate.ts";

export type NewRef = `new:${number}`;

export function isNewRef(value: string): value is NewRef {
  return /^new:[1-9][0-9]*$/.test(value);
}

// Guest output is untrusted: the host parses every line with `guestMessage`.
export const guestMessage = union(
  object({ kind: literal("read"), id: number, fn: string, args: array(unknown) }),
  object({
    kind: literal("write"),
    fn: string,
    args: array(unknown),
    ref: nullable(refine(string, isNewRef, "expected a new:N ref")),
  }),
  object({ kind: literal("intent"), fn: string, args: array(unknown) }),
  object({ kind: literal("draft"), fn: string, args: array(unknown) }),
  object({ kind: literal("log"), text: string }),
  object({ kind: literal("done"), value: unknown }),
  object({ kind: literal("threw"), message: string }),
);
export type GuestMessage = Infer<typeof guestMessage>;

export type HostReply =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string };

export type CapturedMutation = {
  op: string;
  target: ItemId | NewRef | null;
  ref: NewRef | null;
  args: unknown;
  // Two kinds' catalogues may share an op. Absent with a target, and on a create stored before it existed.
  into?: SourceKind;
};

// Never applied in the run: when the turn ends, the last finished run's intents apply, in order.
export type Intent = { action: ActionName; input: Record<string, unknown> };

// Never applied by the run or the turn: the user applies, edits or discards it.
export type Draft = { action: ActionName; input: Record<string, unknown> };

// What any of these throws names the function; the sandbox passes it to the agent as it is.
export type Bindings = {
  dts: string;
  shim: string;
  read(
    fn: string,
    args: readonly unknown[],
  ): Promise<{
    value: unknown;
    outsideRegion: boolean;
    found?: SearchHit[];
    preview?: PreviewTable[];
  }>;
  fields?(fn: string): ResultFields | null;
  capture(fn: string, args: readonly unknown[], ref: NewRef | null): CapturedMutation;
  intend(fn: string, args: readonly unknown[]): Intent;
  draft(fn: string, args: readonly unknown[]): Draft;
};

export type RunLimits = {
  wallMs: number;
  maxScriptBytes: number;
  maxReads: number;
  maxMutations: number;
  maxIntents: number;
  maxResultBytes: number;
  maxConsoleBytes: number;
};

export type RunError = {
  phase: "typecheck" | "runtime" | "limit";
  message: string;
  hint?: string;
  logs: string[];
};

// "unanswered": the run ended before its answer, and a late answer is ignored.
export type ProxiedRead = {
  fn: string;
  args: unknown[];
  ms: number;
  status: "answered" | "failed" | "unanswered";
  outsideRegion: boolean | null;
  // A hash of the payload, never the payload.
  payloadHash: string | null;
};

export type TranscriptEntry =
  | { kind: "log"; text: string }
  | { kind: "return"; value: unknown }
  | { kind: "error"; error: RunError };

export type RunResult = {
  reads: ProxiedRead[];
  mutations: CapturedMutation[];
  intents: Intent[];
  drafts: Draft[];
  transcript: TranscriptEntry[];
  // A sandbox rejects with the reason when the run is aborted, so a result is never "aborted".
  outcome: Exclude<RunOutcome, "aborted">;
  wallMs: number;
  coldStartMs: number | null;
};

// The bindings are the only way out.
export interface Sandbox {
  run(
    script: string,
    bindings: Bindings,
    options: { limits: RunLimits; signal: AbortSignal; log: Log },
  ): Promise<RunResult>;
}
