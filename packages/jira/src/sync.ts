// The sync worker: drives a source's `sync` into the index, one snapshot
// version per sync. Any source works; Jira is the first.
import {
  facets,
  type IndexRecord,
  type Instant,
  isInstant,
  type Log,
  parseItemId,
  type Source,
  type SourceKind,
  type Ulid,
  type Validator,
} from "@oriel/core";
import type { IndexStore } from "@oriel/db";

export type SyncOptions<K extends SourceKind, A> = {
  source: Source<K, A>;
  // The source's attrs shape; each record is checked against it.
  attrs: Validator<A>;
  index: IndexStore;
  workspaceId: Ulid;
  // A full sweep lists everything and marks what the source no longer returns
  // as gone. Otherwise the sync resumes from the stored cursor, and is a full
  // sweep anyway if there is none.
  full: boolean;
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
// sync reclaims the pages already applied.
export async function syncSource<K extends SourceKind, A>(
  options: SyncOptions<K, A>,
): Promise<SyncReport> {
  const { source, attrs, index, workspaceId, log } = options;
  const stored = index.source(workspaceId, source.kind)?.cursor ?? null;
  const cursor = options.full ? null : stored;
  const full = cursor === null;
  const run = index.beginSync(workspaceId, source.kind, attrs, options.clock());
  // Every stable ID the source returned, skipped ones included: a record that
  // can't be indexed still exists, so a full sweep mustn't mark it gone.
  const seen = new Set<string>();
  let last: string | null = null;
  let records = 0;
  let skipped = 0;
  let gone = 0;
  for await (const page of source.sync(cursor)) {
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
    last = page.cursor ?? last;
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
