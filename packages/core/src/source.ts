import type { Approved } from "./changeset.ts";
import type { Instant, ItemId, SourceKind, Ulid } from "./ids.ts";
import type { Validator } from "./validate.ts";

// Field values as the source reports them, keyed by field name.
export type FieldValues = Readonly<Record<string, unknown>>;

// What the index keeps per item: the minimum for grouping, summaries and search.
// Full content is fetched at run time with `Source.read`.
export type IndexRecord<K extends SourceKind = SourceKind, A = unknown> = {
  id: ItemId<K>;
  stableId: string;
  title: string;
  url: string;
  updatedAt: Instant;
  attrs: A;
};

export type SyncPage<K extends SourceKind = SourceKind, A = unknown> = {
  records: IndexRecord<K, A>[];
  // Stable IDs the source no longer has.
  gone: string[];
  cursor: string;
};

export type ReadResult<K extends SourceKind = SourceKind, C = unknown> =
  | { id: ItemId<K>; status: "ok"; content: C }
  | { id: ItemId<K>; status: "moved"; to: ItemId<K> }
  | { id: ItemId<K>; status: "gone"; reason: "deleted" | "forbidden" };

// Sits behind the API token so OAuth can replace it without touching adapters.
export interface Credential {
  headers(): Promise<Record<string, string>>;
}

// The read side of a source. It has no write methods; writing is `SourceWriter`.
export interface Source<K extends SourceKind = SourceKind, A = unknown, C = unknown> {
  readonly kind: K;
  // Changed records since `cursor` (null = everything).
  sync(cursor: string | null): AsyncIterable<SyncPage<K, A>>;
  // Live, full content. A missing ID is a result, never a throw.
  read(ids: readonly ItemId<K>[]): Promise<ReadResult<K, C>[]>;
}

// A source's write operations, by name: how to check each one's arguments,
// and whether it exists only to undo another (a run can't capture those). A
// source with no catalogue is read-only: its items can be read and discussed,
// never changed.
export type OpCatalogue = Readonly<
  Record<string, { args: Validator<unknown>; revertOnly: boolean }>
>;

// One mutation, ready to send: an earlier create's temporary name in the target
// has already been replaced by the created item.
export type WriteRequest<K extends SourceKind = SourceKind> = {
  mutationId: Ulid;
  op: string;
  target: ItemId<K> | null;
  args: unknown;
};

export type WriteResult<K extends SourceKind = SourceKind> = {
  // The item written or created; its stable ID is the external ID.
  item: { id: ItemId<K>; stableId: string };
  // The source's values just before the write; revert restores these.
  before: FieldValues;
  // What the source reported after; revert's conflict check compares to these.
  after: FieldValues;
};

// The write side. Adapters export it only from their `./writer` subpath, and
// only packages/changeset imports that (checked by scripts/check-repo.ts).
export interface SourceWriter<K extends SourceKind = SourceKind> {
  readonly kind: K;
  apply(request: Approved<WriteRequest<K>>): Promise<WriteResult<K>>;
  // Current values, for revert's conflict check.
  current(id: ItemId<K>, fields: readonly string[]): Promise<FieldValues | "gone">;
}
