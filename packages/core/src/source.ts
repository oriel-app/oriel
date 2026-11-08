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
  number,
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
// - `reply:<id>`: one reply in the item's conversation, as its text, or null
//   when there is no such reply; `replies`: how many it has;
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
  // What the item is, in words any source can use: "epic", "story",
  // "task", "bug", "subtask", "doc", "message". An adapter maps its own
  // types onto these.
  kind?: string;
  // Its estimate, or null when it has none yet. Absent when the source
  // doesn't estimate.
  estimate?: number | null;
  // The items its text names, by stable ID, as the index resolved them
  // (decision 0027); `id` is each one's handle now. Oriel's sync fills it
  // and the index adds it on reading: an adapter never sets it.
  references?: { id: ItemId; stableId: string }[];
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

// A hit as the agent's search() returns it: one found by its text rather
// than its key or title carries Oriel's excerpt of the words around the
// match, capped and from the item (search.ts). Only the run result has it,
// never the escape hatch's block.
export type Searched = SearchHit & { excerpt?: string };

export type SyncPage<K extends SourceKind = SourceKind, A = unknown> = {
  records: IndexRecord<K, A>[];
  // Stable IDs the source no longer has.
  gone: string[];
  // Where the next sync resumes; null when the source keeps no cursor.
  cursor: string | null;
  // Each record's text, by stable ID, beside the record and never in it: for
  // Oriel's sync to find references in, and for search, which the index
  // keeps the first 8,192 characters of (OA-242). A record with none keeps
  // the references and text it had.
  texts?: Readonly<Record<string, string>>;
  // Parts of the source this sync lists in full, by the start their stable
  // IDs share, for a source that reads only what moved, such as one
  // spreadsheet's tab: what the index has under one and the sync didn't
  // return is gone, as in a full sweep.
  swept?: readonly string[];
  // Parts it couldn't read this time, the same way: what the index has under
  // one stays as it is, even in a full sweep, as after a failed sync.
  held?: readonly string[];
};

// A live read. Every item's content has its title and its text, so any item
// can be read and named whatever its source; `C` is what else the source
// returns. Both are source content: they reach the model only in tool
// results.
export type ReadResult<K extends SourceKind = SourceKind, C = unknown> =
  | { id: ItemId<K>; status: "ok"; content: { title: string; text: string } & C }
  | { id: ItemId<K>; status: "moved"; to: ItemId<K> }
  | { id: ItemId<K>; status: "gone"; reason: "deleted" | "forbidden" };

// What a region's reads go to: live content from the items' own sources, and
// the index for the escape hatch. The caller binds the workspace.
export type Reader = {
  read(ids: readonly ItemId[]): Promise<ReadResult[]>;
  search(query: string, limit: number): Promise<Searched[]>;
};

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
  // Whose its items are: its connection's prefix, such as `folder.2`, which
  // its IDs carry and the index keeps them under. The kind when absent.
  readonly prefix?: string;
  // Changed records since `cursor` (null = everything).
  sync(cursor: string | null): AsyncIterable<SyncPage<K, A>>;
  // Live, full content. A missing ID is a result, never a throw.
  read(ids: readonly ItemId<K>[]): Promise<ReadResult<K, C>[]>;
  // Index records for these items, each read on its own instead of listed,
  // for a source whose listing lags its writes. `gone` names those the source
  // doesn't have; one it can't read is in neither, as a listing skips it.
  // `texts` as a sync page has them.
  records?(ids: readonly ItemId<K>[]): Promise<{
    records: IndexRecord<K, A>[];
    gone: ItemId<K>[];
    texts?: Readonly<Record<string, string>>;
  }>;
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
  // What the diff the person approved showed for its item just before it,
  // by field. A writer whose source has no conditional write, as Sheets,
  // checks the item still holds these before it writes (decision 0050).
  // Absent where Oriel recorded none.
  seen?: FieldValues;
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
  // Every request it makes for the write, and every wait between them, keeps
  // within `limit`. The engine, its one caller, always gives one.
  apply(request: Approved<WriteRequest<K>>, limit?: WriteLimit): Promise<WriteResult<K>>;
  // Current values, for revert's conflict check.
  current(id: ItemId<K>, fields: readonly string[]): Promise<FieldValues | "gone">;
  // Current values, with the stable ID of the item the handle names now, so
  // a caller can tell its item from one that took the handle since. "gone"
  // when the item can't be read, which tells nothing about what it holds.
  read(
    id: ItemId<K>,
    fields: readonly string[],
  ): Promise<{ stableId: string; values: FieldValues } | "gone">;
  // What a person calls an ID its ops name, such as an account or a
  // channel, asked of the source; null when unknown. Without it, the
  // composition root names them.
  name?(id: string): Promise<string | null>;
  // The ops a revert would send that it can't, by the op, each with a line
  // saying so in a person's words, such as a post a source server has no
  // tool to delete: "A Slack post can't be taken back". It says so before
  // anything is offered, so a change set that would need one offers no
  // Revert. None: it can send every op its catalogue has.
  readonly unsendable?: Readonly<Record<string, string>>;
  // Whether the source would take an op as it stands, asked before a person
  // approves it, for an op whose source decides by the item's own state, as
  // a workflow decides which statuses an item may move to. Null when it
  // would; when it wouldn't, why, in a person's words. It throws when it
  // can't tell, as when the item can't be read. `checks` names the ops it
  // checks; any other is only found out when it's sent.
  readonly checks?: readonly string[];
  check?(
    op: string,
    target: ItemId<K>,
    expectedStableId: string,
    args: unknown,
  ): Promise<string | null>;
}

// What `apply` throws when nothing was sent or changed: the write never went
// out (a read before it, or building the request, failed), or the source
// answered it and made no change, as Jira does with a 4xx. Nothing landed,
// so it can be sent again. `sent` says which. Anything else `apply` throws
// may mean the write landed. `final`: the source would refuse it again as
// approved, whatever the moment, as a workflow refuses a status the item
// can't move to: trying again can't help.
export class SourceRefused extends Error {
  readonly sent: boolean;
  readonly final: boolean;
  constructor(message: string, options: { sent: boolean; final?: boolean; cause?: unknown }) {
    super(message, { cause: options.cause });
    this.name = "SourceRefused";
    this.sent = options.sent;
    this.final = options.final ?? false;
  }
}

// One write's `apply`, so what it throws says whether its request went out.
// `write` calls `sent()` just before the request's bytes leave, once nothing
// can stop them (the reads and checks before it, the time left, the
// sign-in). A failure before then sent nothing, and is thrown as a
// SourceRefused; one after may have landed, and is thrown as it is.
export async function noteSent<T>(write: (sent: () => void) => Promise<T>): Promise<T> {
  let went = false;
  try {
    return await write(() => {
      went = true;
    });
  } catch (error) {
    if (went || error instanceof SourceRefused) throw error;
    const said = error instanceof Error ? error.message : String(error);
    throw new SourceRefused(said, { sent: false, cause: error });
  }
}

// How long a write may still take, in ms by the engine's clock: each request
// `apply` makes for it, their retries and the waits between them.
export type WriteLimit = { left(): number };

// What a transport throws when a write's time runs out before a request of it
// goes out, or when the source asks for it again later than that. Nothing of
// that request reached the source, or the source turned it away unprocessed,
// as with a 429.
export class WriteStalled extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WriteStalled";
  }
}

// How long one request may take: its own timeout, or what is left of the
// write it is for. With none left it isn't sent.
export function requestMs(
  timeoutMs: number,
  limit: WriteLimit | undefined,
  source: string,
): number {
  if (!limit) return timeoutMs;
  const left = limit.left();
  if (left <= 0) throw new WriteStalled(`${source} took longer than Oriel waits on a write`);
  return Math.min(timeoutMs, left);
}

// How long to wait before a request goes again, as the source's Retry-After
// asks: 5 seconds with none, at most 60. Asked to wait longer than the write
// has left, it stalls.
export function retryMs(
  retryAfter: string | null,
  limit: WriteLimit | undefined,
  source: string,
): number {
  const seconds = Number(retryAfter) || 5;
  if (limit && seconds * 1000 > limit.left())
    throw new WriteStalled(
      `${source} asked Oriel to wait ${seconds} seconds before sending it again, longer than Oriel waits on a write`,
    );
  return Math.min(seconds, 60) * 1000;
}

// The common facets' shapes, which the change log checks too.
export const stateShape: Validator<State> = union(
  literal("todo"),
  literal("in-progress"),
  literal("done"),
);
export const peopleShape = array(object({ role: string, id: string, name: string }));
const itemIdShape = refine(string, isItemId, "expected an item ID");
export const containerShape = nullable(object({ id: itemIdShape, stableId: string }));

// Built once: every record the index reads is checked against it.
const facetShape = object({
  people: optional(peopleShape),
  state: optional(stateShape),
  container: optional(containerShape),
  links: optional(array(object({ url: string, title: string }))),
  kind: optional(string),
  estimate: optional(nullable(number)),
  references: optional(array(object({ id: itemIdShape, stableId: string }))),
});

// Facets as the index stores them: checked on the way in and on the way out.
export const facets: Validator<Facets> = (input, path) => {
  const result = facetShape(input, path);
  if (!result.ok) return result;
  // An absent facet stays absent rather than becoming a key set to undefined.
  const value = Object.fromEntries(
    Object.entries(result.value).filter(([, field]) => field !== undefined),
  );
  return { ok: true, value };
};
