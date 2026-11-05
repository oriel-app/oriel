// The sync worker: drives a source's `sync` into the index, one snapshot
// version per sync. It is Oriel's, not any one source's: every source syncs
// through it, and what a sync does beyond storing records runs here, never
// in an adapter's package.
import type { DeclaredFacets } from "./change-log.ts";
import type { Recognizer } from "./references.ts";
import {
  type Instant,
  isInstant,
  type ItemId,
  parseItemId,
  type SourceKind,
  type Ulid,
} from "./ids.ts";
import type { Log } from "./run.ts";
import { facets, type IndexRecord, type Source, type SyncPage } from "./source.ts";
import type { Validator } from "./validate.ts";

// A page as the sync worker hands it to the index: the records; the item
// IDs each record's text names, by stable ID, for the index to resolve; and
// each record's text, for search (OA-242). A record left out of
// `references` or `texts` keeps what it had.
export type IndexPage = Omit<SyncPage, "swept" | "held"> & {
  references?: Readonly<Record<string, readonly ItemId[]>>;
};

// The most items one record's text may name. Synced text is anyone's, and a
// message naming every key in a project would otherwise weigh on every read.
export const maxReferences = 50;

// What the sync worker needs of the index. The index store (packages/db) is
// one; core names only what it calls.
export type SyncIndex = {
  source(workspaceId: Ulid, kind: SourceKind): { cursor: string | null } | null;
  beginSync<A>(
    workspaceId: Ulid,
    source: SourceKind,
    attrs: Validator<A>,
    now: Instant,
    declared?: DeclaredFacets,
  ): { apply(page: IndexPage): void; finish(cursor: string | null, finishedAt: Instant): number };
  liveStableIds(workspaceId: Ulid, source: SourceKind): string[];
  goneStableIds(workspaceId: Ulid, source: SourceKind): string[];
};

export type SyncOptions<K extends SourceKind, A> = {
  source: Source<K, A>;
  // The source's attrs shape and its declared key shape; each record is
  // checked against them.
  attrs: Validator<A>;
  key: RegExp;
  // The source's declared facets, which the change log records beside the
  // common ones: its declaration's `facets`. None when left out.
  facets?: DeclaredFacets;
  // Every source's recognizer as one, run over each record's text (decision
  // 0027). None found when left out.
  recognize?: Recognizer;
  index: SyncIndex;
  workspaceId: Ulid;
  // A full sweep lists everything and marks what the source no longer returns
  // as gone. Otherwise the sync resumes from the stored cursor, and is a full
  // sweep anyway if there is none.
  full: boolean;
  // Items to read one by one, with the stable IDs they were written with:
  // what a change set just wrote, which a listing that lags its writes may
  // not show yet, or may still show once deleted. One the source doesn't
  // have is gone. Needs the source's `records`.
  items?: readonly { id: ItemId<K>; stableId: string }[];
  // Read once when the sync starts and once when it finishes.
  clock: () => Instant;
  log: Log;
};

export type SyncReport = {
  version: number;
  full: boolean;
  records: number;
  skipped: number;
  gone: number;
};

// Run one at a time per workspace (the index store's rule). If the source
// throws partway, nothing is marked gone and the error propagates; the next
// sync reclaims the pages already applied. Items are read before the listing
// starts, so a failed read applies nothing, and land after it, so what was
// read by itself wins over a listing that lags.
export async function syncSource<K extends SourceKind, A>(
  options: SyncOptions<K, A>,
): Promise<SyncReport> {
  const { source, attrs, index, workspaceId, log } = options;
  const recognize = options.recognize ?? (() => []);
  // The index keeps its items under its connection's prefix.
  const prefix = source.prefix ?? source.kind;
  const stored = index.source(workspaceId, prefix)?.cursor ?? null;
  const cursor = options.full ? null : stored;
  const full = cursor === null;
  const items = options.items ?? [];
  if (items.length && !source.records)
    throw new Error(`sync: the ${source.kind} source can't read items one by one`);
  const read =
    items.length && source.records
      ? await source.records(items.map((i) => i.id))
      : { records: [], gone: [], texts: {} };
  const run = index.beginSync(workspaceId, prefix, attrs, options.clock(), options.facets);
  // Every stable ID the source returned, skipped ones included: a record that
  // can't be indexed still exists, so a full sweep mustn't mark it gone.
  const seen = new Set<string>();
  let last: string | null = null;
  // What the source says it listed in full, or couldn't read (`SyncPage`).
  const swept: string[] = [];
  const held: string[] = [];
  let records = 0;
  let skipped = 0;
  let gone = 0;
  const keep = (page: SyncPage<K, A>) => {
    const valid = page.records.filter((record) => {
      if (record.stableId) seen.add(record.stableId);
      const problem = check(prefix, options.key, attrs, record);
      if (problem === null) return true;
      skipped++;
      log("sync: skipped a malformed record", {
        source: prefix,
        stableId: record.stableId,
        problem,
      });
      return false;
    });
    // Each text is read here for the IDs it names, and goes to the index for
    // search.
    const given = page.texts ?? {};
    const textOf = (record: IndexRecord<K, A>) =>
      Object.hasOwn(given, record.stableId) ? given[record.stableId] : undefined;
    const references = Object.fromEntries(
      valid.flatMap((record) => {
        const text = textOf(record);
        if (text === undefined) return [];
        const named = recognize(text)
          .filter((id) => id !== record.id)
          .slice(0, maxReferences);
        return [[record.stableId, named]];
      }),
    );
    const texts = Object.fromEntries(
      valid.flatMap((record) => {
        const text = textOf(record);
        return text === undefined ? [] : [[record.stableId, text]];
      }),
    );
    swept.push(...(page.swept ?? []));
    held.push(...(page.held ?? []));
    run.apply({ records: valid, gone: page.gone, cursor: page.cursor, references, texts });
    records += valid.length;
    gone += page.gone.length;
  };
  // What the index holds as gone, a listing that lags its source may still
  // return, as Jira's search lists a deleted issue for a while. A source that
  // can read by key is asked first, and only what it still has comes back; one
  // that can't is taken at its word. The items above are read already.
  const tombstoned = new Set(source.records ? index.goneStableIds(workspaceId, prefix) : []);
  const ours = new Set(items.map((item) => item.stableId));
  const confirmed = async (page: SyncPage<K, A>): Promise<SyncPage<K, A>> => {
    const back = page.records.filter((r) => tombstoned.has(r.stableId) && !ours.has(r.stableId));
    if (!page.records.some((r) => tombstoned.has(r.stableId)) || !source.records) return page;
    const found = back.length ? (await source.records(back.map((r) => r.id))).records : [];
    const still = new Map(found.map((record) => [record.stableId, record]));
    const kept = page.records.flatMap((r) =>
      tombstoned.has(r.stableId) ? (still.get(r.stableId) ?? []) : [r],
    );
    const stale = back.filter((r) => !still.has(r.stableId)).length;
    if (stale) log("sync: the listing returned items the source no longer has", { stale });
    return { ...page, records: kept };
  };
  // When the listing last saw each item updated, by stable ID.
  const listed = new Map<string, Instant>();
  // A listing that lags would set an item read by key back to how it was
  // before its write, and the read forward again, which the change log would
  // keep as moves the source never made. So where the read is as new as the
  // listing, the read alone lands, after the listing.
  const readBy = new Map(read.records.map((record) => [record.stableId, record.updatedAt]));
  const behind = (record: IndexRecord<K, A>) => {
    const own = readBy.get(record.stableId);
    return own !== undefined && !(own < record.updatedAt);
  };
  for await (const returned of source.sync(cursor)) {
    const page = await confirmed(returned);
    for (const record of page.records) listed.set(record.stableId, record.updatedAt);
    for (const record of page.records.filter(behind)) seen.add(record.stableId);
    keep({ ...page, records: page.records.filter((record) => !behind(record)) });
    last = page.cursor ?? last;
  }
  // A read the listing has since overtaken is left out. The cursor stays the
  // listing's: these reads say nothing of what else changed.
  if (items.length) {
    const live = new Set(index.liveStableIds(workspaceId, prefix));
    keep({
      records: read.records.filter(
        (record) => !(record.updatedAt < (listed.get(record.stableId) ?? "")),
      ),
      gone: items
        .filter((item) => read.gone.includes(item.id) && live.has(item.stableId))
        .map((item) => item.stableId),
      cursor: null,
      ...(read.texts ? { texts: read.texts } : {}),
    });
  }
  const under = (parts: readonly string[], id: string) => parts.some((part) => id.startsWith(part));
  if (full || swept.length) {
    const missing = index
      .liveStableIds(workspaceId, prefix)
      .filter((id) => !seen.has(id) && (full || under(swept, id)) && !under(held, id));
    if (missing.length) run.apply({ records: [], gone: missing, cursor: last });
    gone += missing.length;
  }
  const version = run.finish(last, options.clock());
  log("sync: finished", { source: prefix, version, full, records, skipped, gone });
  return { version, full, records, skipped, gone };
}

// The index store's own checks, made per record so one bad record is skipped
// instead of failing its page. Attrs are checked after a JSON round trip, as
// the index reads them back.
// A record's ID names the source's own connection: its prefix is the one the
// index keeps it under.
function check<A>(
  prefix: string,
  key: RegExp,
  attrs: Validator<A>,
  record: IndexRecord,
): string | null {
  const id = parseItemId(record.id);
  if (id?.prefix !== prefix || !key.test(id.key)) return `not a ${prefix} item ID`;
  if (!record.stableId || typeof record.stableId !== "string") return "empty stable ID";
  if (typeof record.title !== "string" || typeof record.location !== "string")
    return "title and location must be strings";
  const checked = facets(JSON.parse(JSON.stringify(record.facets) ?? "null"), "$.facets");
  if (!checked.ok)
    return checked.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
  if (checked.value.references !== undefined)
    return "references are Oriel's to find, never an adapter's to set";
  if (!isInstant(record.updatedAt)) return "updatedAt is not a canonical instant";
  const parsed = attrs(JSON.parse(JSON.stringify(record.attrs) ?? "null"), "$.attrs");
  if (!parsed.ok) return parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
  return null;
}
