import type { Instant, ItemId, SourceKind, Ulid } from "./ids.ts";
import type { Log } from "./run.ts";
import type { ThroughServer } from "./servers.ts";
import type { FieldValues, IndexRecord, Source } from "./source.ts";
import type { Validator } from "./validate.ts";

export type ToOpen = {
  id: Ulid;
  number: number;
  prefix: string;
  identity: string;
  options: Readonly<Record<string, unknown>>;
};

export type OwnItems = {
  records(): readonly IndexRecord[];
  content(stableId: string): unknown;
  keys(): readonly string[];
  // `what` is for telemetry, never the write's words.
  write(change: {
    records: readonly IndexRecord[];
    texts: Readonly<Record<string, string>>;
    contents: Readonly<Record<string, unknown>>;
    gone: readonly string[];
    what: OwnWrite;
  }): Promise<void>;
};

export type OwnWrite = {
  by: "person" | "change-set";
  change: "created" | "edited" | "deleted";
  fields: readonly string[];
};

export type OpenVia = {
  // Only a connector's fixture reads it, never its own `open`.
  fetch?: typeof fetch;
  log: Log;
  now: () => Instant;
  own?: OwnItems;
  server?: ThroughServer;
};

export const noOptionsYet = "It has no options yet.";
export const readsNow = "It reads with these options. Draft a change only when the user asks.";

export class OptionsUnfit extends Error {
  override name = "OptionsUnfit";
}

export type FieldReader<K extends SourceKind = SourceKind> = {
  current(id: ItemId<K>, fields: readonly string[]): Promise<FieldValues | "gone">;
  name(id: string): Promise<string | null>;
};

export type Opened<C = unknown, R = unknown, W = unknown> = {
  source: Source<SourceKind, unknown>;
  attrs: Validator<unknown>;
  identity?: string;
  about: string;
  scope: R;
  context: () => C;
  // Without it the connection is read-only: no writer is built, so a write is unreachable.
  writes?: W;
  fields?: FieldReader;
  // A person's own edit, never the agent's, whose writes are change sets.
  edit?(
    id: ItemId,
    values: Readonly<Record<string, unknown>>,
  ): Promise<{ before: Record<string, unknown>; after: Record<string, unknown> }>;
  // Frozen, so its "stuck" rules come out the same on every run.
  frozen?: Instant;
  incremental?: true;
  // How long its listing may lag a write, as Jira's search does: until then each sync reads what Oriel wrote by key.
  lagMs?: number;
  problem(error: unknown): string;
  report?(): readonly string[];
  unfit?(): string | null;
  viewOnly?(records: readonly IndexRecord[]): { why: string; all: boolean } | null;
  names?(records: readonly IndexRecord[]): Iterable<readonly [string, string]>;
  close?(): void;
};
