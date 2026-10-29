import type { ItemId } from "./ids.ts";
import type { Log } from "./run.ts";
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

// The temporary name of an item created earlier in the same run.
export type NewRef = `new:${number}`;

export function isNewRef(value: string): value is NewRef {
  return /^new:[1-9][0-9]*$/.test(value);
}

// Guest → host, one JSON object per line on stdout. Guest output is untrusted:
// the host parses every line with `guestMessage`. Reads get a reply; writes are
// queued as captured mutations and never answered.
export const guestMessage = union(
  object({ kind: literal("read"), id: number, fn: string, args: array(unknown) }),
  object({
    kind: literal("write"),
    fn: string,
    args: array(unknown),
    ref: nullable(refine(string, isNewRef, "expected a new:N ref")),
  }),
  object({ kind: literal("log"), text: string }),
  object({ kind: literal("done"), value: unknown }),
  object({ kind: literal("threw"), message: string }),
);
export type GuestMessage = Infer<typeof guestMessage>;

// Host → guest, one JSON object per line on stdin: the answer to a read.
export type HostReply =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string };

export type CapturedMutation = {
  op: string;
  target: ItemId | NewRef | null;
  ref: NewRef | null;
  args: unknown;
};

// A region's bindings, built per run: the declarations the agent codes
// against, the guest stubs generated from the same description, and the host
// side. `read` proxies live. `capture` validates a write against the source's
// op catalogue and throws if its target is outside the region.
export type Bindings = {
  dts: string;
  shim: string;
  read(fn: string, args: readonly unknown[]): Promise<{ value: unknown; outsideRegion: boolean }>;
  capture(fn: string, args: readonly unknown[], ref: NewRef | null): CapturedMutation;
};

export type RunLimits = {
  wallMs: number;
  maxScriptBytes: number;
  maxReads: number;
  maxMutations: number;
  maxResultBytes: number;
  maxConsoleBytes: number;
};

// Shaped so the agent can fix its own script: what failed, where, a hint, and
// the log lines leading up to it.
export type RunError = {
  phase: "typecheck" | "runtime" | "limit";
  message: string;
  hint?: string;
  logs: string[];
};

export type ProxiedRead = {
  fn: string;
  args: unknown[];
  ms: number;
  // True for the escape hatch (`search()` and reads of what it found).
  outsideRegion: boolean;
  // A hash of the payload, never the payload (SPEC §7).
  payloadHash: string;
};

export type TranscriptEntry =
  | { kind: "log"; text: string }
  | { kind: "return"; value: unknown }
  | { kind: "error"; error: RunError };

export type RunResult = {
  reads: ProxiedRead[];
  mutations: CapturedMutation[];
  transcript: TranscriptEntry[];
  outcome: "ok" | "threw" | "timeout" | "limit";
  wallMs: number;
};

// One run of agent-written TypeScript. The bindings are the only way out.
export interface Sandbox {
  run(
    script: string,
    bindings: Bindings,
    options: { limits: RunLimits; signal: AbortSignal; log: Log },
  ): Promise<RunResult>;
}
