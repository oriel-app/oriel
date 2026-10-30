// The item contract (decision 0019). Core knows items, not any one source: an
// item has a source-qualified ID, a title, a location, an update time, its
// content as text and optional facets. Whatever else a source knows stays in
// its adapter, as `attrs` in the index and as extra content on a read.
import type { Approved } from "./changeset.ts";
import { type Instant, type ItemId, isItemId, type SourceKind, type Ulid } from "./ids.ts";
import {
  array,
  literal,
  nullable,
  object,
  optional,
  refine,
  string,
  union,
  type Validator,
} from "./validate.ts";

// Field values as a source reports them, keyed by field name. Every writable
// source uses the same names for what they have in common, so change sets can
// diff, check and revert any of them:
// - `summary`: the item's title;
// - `description`: its body as plain text, "" when empty;
// - `points`: its estimate, a number or null;
// - `assignee`: the assigned person's ID in the source, or null;
// - `epic`: the item ID of its parent, or null;
// - `link:<id>`: one link as `{ url, title }`, or null when there is no such
//   link;
// - `updated`: when the item last changed, an instant. It belongs to the item,
//   not to a field: any write moves it, so field conflict checks ignore it.
// A source reports only the names that apply to it.
export type FieldValues = Readonly<Record<string, unknown>>;

// Where an item stands, as far as its source tracks work at all.
export type State = "todo" | "in-progress" | "done";

// What groupings can use across sources. Each field is optional: absent means
// the source has no such thing (a folder has no assignees); null or empty
// means it has, and this item has none.
export type Facets = {
  // People by their role on the item, such as "assignee".
  people?: { role: string; id: string; name: string }[];
  state?: State;
  // The item's parent, such as its epic. Identity is by stable ID; `id` is
  // the parent's handle when the item was read.
  container?: { id: ItemId; stableId: string } | null;
  // Where the item points, outside its source.
  links?: { url: string; title: string }[];
};

// What the index keeps per item: the minimum for grouping, summaries and
// search. Full content is fetched at run time with `Source.read`.
export type IndexRecord<K extends SourceKind = SourceKind, A = unknown> = {
  id: ItemId<K>;
  stableId: string;
  title: string;
  // Where the item lives: a URL, or a `file:` URL for a local file.
  location: string;
  updatedAt: Instant;
  facets: Facets;
  // The source's own fields, which only its adapter reads.
  attrs: A;
};

// What `search()` finds: enough to name an item and point at it.
export type SearchHit = Pick<IndexRecord, "id" | "title" | "location" | "updatedAt">;

export type SyncPage<K extends SourceKind = SourceKind, A = unknown> = {
  records: IndexRecord<K, A>[];
  // Stable IDs the source no longer has.
  gone: string[];
  // Where the next sync resumes; null when the source keeps no cursor.
  cursor: string | null;
};

// A live read. Every item's content has its text, so any item can be read
// whatever its source; `C` is what else the source returns.
export type ReadResult<K extends SourceKind = SourceKind, C = unknown> =
  | { id: ItemId<K>; status: "ok"; content: { text: string } & C }
  | { id: ItemId<K>; status: "moved"; to: ItemId<K> }
  | { id: ItemId<K>; status: "gone"; reason: "deleted" | "forbidden" };

// What a region's reads go to: live content from the items' own sources, and
// the index for the escape hatch. The caller binds the workspace.
export type Reader = {
  read(ids: readonly ItemId[]): Promise<ReadResult[]>;
  search(query: string, limit: number): Promise<SearchHit[]>;
};

// Sits behind the API token so OAuth can replace it without touching adapters.
export interface Credential {
  headers(): Promise<Record<string, string>>;
}

// A source's write operations, by name: how to check each one's arguments,
// and whether it exists only to undo another (a run can't capture those). A
// source with no catalogue is read-only: its items can be read and discussed,
// never changed.
export type OpCatalogue = Readonly<
  Record<string, { args: Validator<unknown>; revertOnly: boolean }>
>;

// The read side of a source. It has no write methods; writing is `SourceWriter`.
export interface Source<K extends SourceKind = SourceKind, A = unknown, C = unknown> {
  readonly kind: K;
  // Changed records since `cursor` (null = everything).
  sync(cursor: string | null): AsyncIterable<SyncPage<K, A>>;
  // Live, full content. A missing ID is a result, never a throw.
  read(ids: readonly ItemId<K>[]): Promise<ReadResult<K, C>[]>;
  // What can be written, if anything.
  readonly ops?: OpCatalogue;
}

// One mutation, ready to send: an earlier create's temporary name in the target
// has already been replaced by the created item.
export type WriteRequest<K extends SourceKind = SourceKind> = {
  mutationId: Ulid;
  op: string;
  target: ItemId<K> | null;
  // The stable ID the target must have, null exactly when there is no target.
  // A writer reads the item before it writes and refuses a mismatch: the
  // handle now names another item, as when a recreated project reuses keys.
  expectedStableId: string | null;
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

const state: Validator<State> = union(literal("todo"), literal("in-progress"), literal("done"));

// Facets as the index stores them: checked on the way in and on the way out.
export const facets: Validator<Facets> = (input, path) => {
  const result = object({
    people: optional(array(object({ role: string, id: string, name: string }))),
    state: optional(state),
    container: optional(
      nullable(object({ id: refine(string, isItemId, "expected an item ID"), stableId: string })),
    ),
    links: optional(array(object({ url: string, title: string }))),
  })(input, path);
  if (!result.ok) return result;
  // An absent facet stays absent rather than becoming a key set to undefined.
  const value = Object.fromEntries(
    Object.entries(result.value).filter(([, field]) => field !== undefined),
  );
  return { ok: true, value };
};
