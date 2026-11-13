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

// `updated` belongs to the item, not a field: any write moves it, so field conflict checks ignore it.
export type FieldValues = Readonly<Record<string, unknown>>;

export type State = "todo" | "in-progress" | "done";

// Absent: the source has no such thing. Null or empty: it has, and this item has none.
export type Facets = {
  people?: { role: string; id: string; name: string }[];
  state?: State;
  container?: { id: ItemId; stableId: string } | null;
  links?: { url: string; title: string }[];
  kind?: string;
  estimate?: number | null;
  // Oriel's sync fills it; an adapter never sets it.
  references?: { id: ItemId; stableId: string }[];
};

export type IndexRecord<K extends SourceKind = SourceKind, A = unknown> = {
  id: ItemId<K>;
  stableId: string;
  title: string;
  location: string;
  updatedAt: Instant;
  facets: Facets;
  attrs: A;
};

export type SearchHit = Pick<IndexRecord, "id" | "title" | "location" | "updatedAt">;

// Only the run result has an excerpt, never the escape hatch's block.
export type Searched = SearchHit & { excerpt?: string };

export type SyncPage<K extends SourceKind = SourceKind, A = unknown> = {
  records: IndexRecord<K, A>[];
  gone: string[];
  cursor: string | null;
  // Beside the record, never in it.
  texts?: Readonly<Record<string, string>>;
  swept?: readonly string[];
  held?: readonly string[];
};

// Both are source content: they reach the model only in tool results.
export type ReadResult<K extends SourceKind = SourceKind, C = unknown> =
  | { id: ItemId<K>; status: "ok"; content: { title: string; text: string } & C }
  | { id: ItemId<K>; status: "moved"; to: ItemId<K> }
  | { id: ItemId<K>; status: "gone"; reason: "deleted" | "forbidden" };

export type Reader = {
  read(ids: readonly ItemId[]): Promise<ReadResult[]>;
  search(query: string, limit: number): Promise<Searched[]>;
};

export type OpCatalogue = Readonly<
  Record<string, { args: Validator<unknown>; revertOnly: boolean }>
>;

export interface Source<K extends SourceKind = SourceKind, A = unknown, C = unknown> {
  readonly kind: K;
  readonly prefix?: string;
  sync(cursor: string | null): AsyncIterable<SyncPage<K, A>>;
  // Live, full content. A missing ID is a result, never a throw.
  read(ids: readonly ItemId<K>[]): Promise<ReadResult<K, C>[]>;
  records?(ids: readonly ItemId<K>[]): Promise<{
    records: IndexRecord<K, A>[];
    gone: ItemId<K>[];
    texts?: Readonly<Record<string, string>>;
  }>;
  readonly ops?: OpCatalogue;
}

export type WriteRequest<K extends SourceKind = SourceKind> = {
  mutationId: Ulid;
  op: string;
  target: ItemId<K> | null;
  // A writer reads the item before it writes and refuses a mismatch: the handle may now name another item,
  // as when a recreated project reuses keys.
  expectedStableId: string | null;
  args: unknown;
  // A writer whose source has no conditional write, as Sheets, checks the item still holds these before it writes.
  seen?: FieldValues;
};

export type WriteResult<K extends SourceKind = SourceKind> = {
  item: { id: ItemId<K>; stableId: string };
  before: FieldValues;
  after: FieldValues;
};

// Adapters export it only from their `./writer` subpath, which only packages/changeset imports (scripts/check-repo.ts).
export interface SourceWriter<K extends SourceKind = SourceKind> {
  readonly kind: K;
  apply(request: Approved<WriteRequest<K>>, limit?: WriteLimit): Promise<WriteResult<K>>;
  current(id: ItemId<K>, fields: readonly string[]): Promise<FieldValues | "gone">;
  // "gone" when the item can't be read, which tells nothing about what it holds.
  read(
    id: ItemId<K>,
    fields: readonly string[],
  ): Promise<{ stableId: string; values: FieldValues } | "gone">;
  name?(id: string): Promise<string | null>;
  readonly unsendable?: Readonly<Record<string, string>>;
  readonly checks?: readonly string[];
  check?(
    op: string,
    target: ItemId<K>,
    expectedStableId: string,
    args: unknown,
  ): Promise<string | null>;
}

// Nothing landed, so it can be sent again; anything else `apply` throws may mean the write landed.
// `final`: the source would refuse it again, whatever the moment, so trying again can't help.
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

// `write` calls `sent()` just before the request's bytes leave: a failure before then sent nothing and is a
// SourceRefused; one after may have landed and is thrown as it is.
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

// Milliseconds, by the engine's clock.
export type WriteLimit = { left(): number };

// Nothing of that request reached the source, or the source turned it away unprocessed, as with a 429.
export class WriteStalled extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WriteStalled";
  }
}

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

export const stateShape: Validator<State> = union(
  literal("todo"),
  literal("in-progress"),
  literal("done"),
);
export const peopleShape = array(object({ role: string, id: string, name: string }));
const itemIdShape = refine(string, isItemId, "expected an item ID");
export const containerShape = nullable(object({ id: itemIdShape, stableId: string }));

const facetShape = object({
  people: optional(peopleShape),
  state: optional(stateShape),
  container: optional(containerShape),
  links: optional(array(object({ url: string, title: string }))),
  kind: optional(string),
  estimate: optional(nullable(number)),
  references: optional(array(object({ id: itemIdShape, stableId: string }))),
});

export const facets: Validator<Facets> = (input, path) => {
  const result = facetShape(input, path);
  if (!result.ok) return result;
  const value = Object.fromEntries(
    Object.entries(result.value).filter(([, field]) => field !== undefined),
  );
  return { ok: true, value };
};
