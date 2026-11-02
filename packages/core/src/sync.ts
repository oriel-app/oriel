// The sync worker: drives a source's `sync` into the index, one snapshot
// version per sync. It is Oriel's, not any one source's: every source syncs
// through it, and what a sync does beyond storing records runs here, never
// in an adapter's package.
import type { DeclaredFacets } from "./change-log.ts";
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
  ): { apply(page: SyncPage): void; finish(cursor: string | null, finishedAt: Instant): number };
  liveStableIds(workspaceId: Ulid, source: SourceKind): string[];
  goneStableIds(workspaceId: Ulid, source: SourceKind): string[];
};

export type SyncOptions<K extends SourceKind, A> = {
  source: Source<K, A>;
  // The source's attrs shape; each record is checked against it.
  attrs: Validator<A>;
  // The source's declared facets, which the change log records beside the
  // common ones: its declaration's `facets`. None when left out.
  facets?: DeclaredFacets;
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
  const stored = index.source(workspaceId, source.kind)?.cursor ?? null;
  const cursor = options.full ? null : stored;
  const full = cursor === null;
  const items = options.items ?? [];
  if (items.length && !source.records)
    throw new Error(`sync: the ${source.kind} source can't read items one by one`);
  const read =
    items.length && source.records
      ? await source.records(items.map((i) => i.id))
      : { records: [], gone: [] };
  const run = index.beginSync(workspaceId, source.kind, attrs, options.clock(), options.facets);
  // Every stable ID the source returned, skipped ones included: a record that
  // can't be indexed still exists, so a full sweep mustn't mark it gone.
  const seen = new Set<string>();
  let last: string | null = null;
  let records = 0;
  let skipped = 0;
  let gone = 0;
  const keep = (page: SyncPage<K, A>) => {
    const valid = page.records.filter((record) => {
      if (record.stableId) seen.add(record.stableId);
      const problem = check(source.kind, attrs, record);
      if (problem === null) return true;
      skipped++;
      log("sync: skipped a malformed record", {
        source: source.kind,
        stableId: record.stableId,
        problem,
      });
      return false;
    });
    run.apply({ records: valid, gone: page.gone, cursor: page.cursor });
    records += valid.length;
    gone += page.gone.length;
  };
  // What the index holds as gone, a listing that lags its source may still
  // return, as Jira's search lists a deleted issue for a while. A source that
  // can read by key is asked first, and only what it still has comes back; one
  // that can't is taken at its word. The items above are read already.
  const tombstoned = new Set(source.records ? index.goneStableIds(workspaceId, source.kind) : []);
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
    const live = new Set(index.liveStableIds(workspaceId, source.kind));
    keep({
      records: read.records.filter(
        (record) => !(record.updatedAt < (listed.get(record.stableId) ?? "")),
      ),
      gone: items
        .filter((item) => read.gone.includes(item.id) && live.has(item.stableId))
        .map((item) => item.stableId),
      cursor: null,
    });
  }
  if (full) {
    const missing = index.liveStableIds(workspaceId, source.kind).filter((id) => !seen.has(id));
    if (missing.length) run.apply({ records: [], gone: missing, cursor: last });
    gone += missing.length;
  }
  const version = run.finish(last, options.clock());
  log("sync: finished", { source: source.kind, version, full, records, skipped, gone });
  return { version, full, records, skipped, gone };
}

// The index store's own checks, made per record so one bad record is skipped
// instead of failing its page. Attrs are checked after a JSON round trip, as
// the index reads them back.
function check<A>(kind: SourceKind, attrs: Validator<A>, record: IndexRecord): string | null {
  if (parseItemId(record.id)?.source !== kind) return `not a ${kind} item ID`;
  if (!record.stableId || typeof record.stableId !== "string") return "empty stable ID";
  if (typeof record.title !== "string" || typeof record.location !== "string")
    return "title and location must be strings";
  const checked = facets(JSON.parse(JSON.stringify(record.facets) ?? "null"), "$.facets");
  if (!checked.ok)
    return checked.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
  if (!isInstant(record.updatedAt)) return "updatedAt is not a canonical instant";
  const parsed = attrs(JSON.parse(JSON.stringify(record.attrs) ?? "null"), "$.attrs");
  if (!parsed.ok) return parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
  return null;
}
