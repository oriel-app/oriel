import type { DatabaseSync } from "node:sqlite";
import {
  facets,
  type IndexRecord,
  type Instant,
  isInstant,
  isItemId,
  nullable,
  number,
  object,
  parseItemId,
  refine,
  type SourceKind,
  sourceKinds,
  string,
  type SyncPage,
  type Ulid,
  unknown,
  type Validator,
} from "@oriel/core";
import { transaction } from "./open.ts";

const itemRow = object({
  item_id: refine(string, isItemId, "expected an item ID"),
  stable_id: string,
  title: string,
  location: string,
  updated_at: refine(string, isInstant, "expected an instant"),
  facets: string,
  attrs: string,
});

const sourceRow = object({
  cursor: nullable(string),
  synced_at: nullable(refine(string, isInstant, "expected an instant")),
});
const versionRow = object({ version: nullable(number) });
const existsRow = object({ found: number });

// Case- and accent-folded: NFKD, then the Combining Diacritical Marks block
// (U+0300–U+036F) is dropped. So "cafe" finds "Café", Cyrillic "й" folds to
// "и", and Japanese voicing marks, which sit outside the block, survive.
const diacritics = new RegExp("[\\u0300-\\u036f]", "g");
const fold = (text: string) =>
  text.normalize("NFKD").replace(diacritics, "").toLocaleLowerCase("en");

// The model writes search queries, and synced content can steer it, so search
// work is bounded.
const maxQueryChars = 256;
const maxTerms = 8;
const maxResults = 50;
const sourcePrefix = new RegExp(`^(${sourceKinds.join("|")}):`);

export type IndexStore = ReturnType<typeof indexStore>;

// The index the sync worker writes and the window, `search()` and the stale
// marker read. One complete sync of a source is one snapshot version. Run one
// sync at a time per workspace.
export function indexStore(db: DatabaseSync) {
  const retireHandle = db.prepare(`
    update items set gone_at = ?, snapshot = ?
    where workspace_id = ? and item_id = ? and stable_id is not ? and gone_at is null`);
  const upsert = db.prepare(`
    insert into items (workspace_id, source, stable_id, item_id, title, location, updated_at, facets, attrs, snapshot)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict (workspace_id, source, stable_id) do update set
      item_id = excluded.item_id, title = excluded.title, location = excluded.location,
      updated_at = excluded.updated_at, facets = excluded.facets, attrs = excluded.attrs,
      snapshot = excluded.snapshot, gone_at = null
    where items.item_id is not excluded.item_id or items.title is not excluded.title
      or items.location is not excluded.location or items.updated_at is not excluded.updated_at
      or items.facets is not excluded.facets or items.attrs is not excluded.attrs
      or items.gone_at is not null`);
  const tombstone = db.prepare(`
    update items set gone_at = ?, snapshot = ?
    where workspace_id = ? and source = ? and stable_id = ? and gone_at is null`);
  const changedIn = db.prepare(
    "select exists (select 1 from items where workspace_id = ? and source = ? and snapshot = ?) as found",
  );
  const saveSource = db.prepare(`
    insert into sources (workspace_id, kind, cursor, synced_at) values (?, ?, ?, ?)
    on conflict (workspace_id, kind) do update set
      cursor = coalesce(excluded.cursor, sources.cursor), synced_at = excluded.synced_at`);
  const insertSnapshot = db.prepare(
    "insert into snapshots (workspace_id, version, source, taken_at) values (?, ?, ?, ?)",
  );
  const selectLatest = db.prepare(
    "select max(version) as version from snapshots where workspace_id = ?",
  );
  const selectLive = db.prepare(`
    select item_id, stable_id, title, location, updated_at, facets, attrs from items
    where workspace_id = ? and gone_at is null and (? is null or source = ?) order by item_id`);
  const selectLiveIds = db.prepare(
    "select stable_id from items where workspace_id = ? and source = ? and gone_at is null order by stable_id",
  );
  const selectGoneIds = db.prepare(
    "select stable_id from items where workspace_id = ? and source = ? and gone_at is not null order by stable_id",
  );
  const selectSource = db.prepare(
    "select cursor, synced_at from sources where workspace_id = ? and kind = ?",
  );

  const snapshot = (workspaceId: Ulid) => {
    const row = versionRow(selectLatest.get(workspaceId));
    return row.ok ? (row.value.version ?? 0) : 0;
  };

  const live = <A>(workspaceId: Ulid, source: SourceKind | null, attrs: Validator<A>) =>
    selectLive.all(workspaceId, source, source).map((raw): IndexRecord<SourceKind, A> => {
      const row = itemRow(raw);
      if (!row.ok) throw new Error(`corrupt index row: ${JSON.stringify(row.issues)}`);
      const parsed = attrs(JSON.parse(row.value.attrs), "$.attrs");
      if (!parsed.ok) {
        throw new Error(
          `index attrs don't match: ${row.value.item_id} ${JSON.stringify(parsed.issues)}`,
        );
      }
      const stored = facets(JSON.parse(row.value.facets), "$.facets");
      if (!stored.ok)
        throw new Error(
          `corrupt index facets: ${row.value.item_id} ${JSON.stringify(stored.issues)}`,
        );
      return {
        id: row.value.item_id,
        stableId: row.value.stable_id,
        title: row.value.title,
        location: row.value.location,
        updatedAt: row.value.updated_at,
        facets: stored.value,
        attrs: parsed.value,
      };
    });

  // Pages are checked the way reads check rows, attrs included after a JSON
  // round trip, so one bad record can't break the window later.
  const check = <A>(source: SourceKind, attrs: Validator<A>, page: SyncPage) => {
    for (const r of page.records) {
      if (parseItemId(r.id)?.source !== source) {
        throw new Error(`${JSON.stringify(r.id)} is not a ${source} item ID`);
      }
      if (!isInstant(r.updatedAt)) throw new Error(`${r.id}: updatedAt is not a canonical instant`);
      if (!r.stableId) throw new Error(`${r.id}: empty stable ID`);
      const checked = facets(JSON.parse(JSON.stringify(r.facets) ?? "null"), "$.facets");
      if (!checked.ok)
        throw new Error(`${r.id}: facets don't match: ${JSON.stringify(checked.issues)}`);
      const parsed = attrs(JSON.parse(JSON.stringify(r.attrs) ?? "null"), "$.attrs");
      if (!parsed.ok)
        throw new Error(`${r.id}: attrs don't match: ${JSON.stringify(parsed.issues)}`);
    }
  };

  return {
    snapshot,

    // One source's live records, with attrs checked against that source's shape.
    records<A>(
      workspaceId: Ulid,
      source: SourceKind,
      attrs: Validator<A>,
    ): IndexRecord<SourceKind, A>[] {
      return live(workspaceId, source, attrs);
    },

    // Opens a sync of one source; `attrs` is that source's shape. Each page
    // commits on its own. `finish` takes the snapshot version if anything
    // changed, records the cursor (null keeps the stored one) and the finish
    // time, and returns the version the index is at. A crash partway leaves
    // pages tagged with an unclaimed version, which the next sync reclaims.
    beginSync<A>(workspaceId: Ulid, source: SourceKind, attrs: Validator<A>, now: Instant) {
      const version = snapshot(workspaceId) + 1;
      return {
        version,
        apply(page: SyncPage): void {
          check(source, attrs, page);
          transaction(db, () => {
            for (const r of page.records) {
              retireHandle.run(now, version, workspaceId, r.id, r.stableId);
              upsert.run(
                workspaceId,
                source,
                r.stableId,
                r.id,
                r.title,
                r.location,
                r.updatedAt,
                JSON.stringify(r.facets),
                JSON.stringify(r.attrs),
                version,
              );
            }
            for (const stableId of page.gone)
              tombstone.run(now, version, workspaceId, source, stableId);
          });
        },
        finish(cursor: string | null, finishedAt: Instant): number {
          return transaction(db, () => {
            saveSource.run(workspaceId, source, cursor, finishedAt);
            const changed = existsRow(changedIn.get(workspaceId, source, version));
            if (!changed.ok || !changed.value.found) return version - 1;
            insertSnapshot.run(workspaceId, version, source, finishedAt);
            return version;
          });
        },
      };
    },

    // The escape hatch, across every source. Every term must appear in the
    // item's key or title; a "jira:" prefix on a term is ignored, so a full
    // item ID works as a query. An exact key comes first, then titles starting
    // with the first term, then the most recently updated. At most 256
    // characters, 8 distinct terms and 50 results.
    search(workspaceId: Ulid, query: string, limit: number): IndexRecord<SourceKind, unknown>[] {
      const bounded = fold(query.slice(0, maxQueryChars));
      const stripped = bounded
        .split(/\s+/)
        .map((term) => term.replace(sourcePrefix, ""))
        .filter(Boolean);
      const terms = [...new Set(stripped)].slice(0, maxTerms);
      const first = terms[0];
      const count = Math.min(Math.max(Math.trunc(limit) || 0, 1), maxResults);
      if (!first) return [];
      const whole = bounded.trim().replace(sourcePrefix, "");
      return live(workspaceId, null, unknown)
        .map((record) => {
          const key = fold(parseItemId(record.id)?.key ?? "");
          const title = fold(record.title);
          return { record, key, title, haystack: `${key} ${title}` };
        })
        .filter(({ haystack }) => terms.every((term) => haystack.includes(term)))
        .sort(
          (a, b) =>
            Number(b.key === whole) - Number(a.key === whole) ||
            Number(b.title.startsWith(first)) - Number(a.title.startsWith(first)) ||
            b.record.updatedAt.localeCompare(a.record.updatedAt),
        )
        .slice(0, count)
        .map(({ record }) => record);
    },

    // For the sync worker's full sweep: whatever the source no longer returns is gone.
    liveStableIds(workspaceId: Ulid, source: SourceKind): string[] {
      return selectLiveIds.all(workspaceId, source).map((row) => String(row.stable_id));
    },

    // For the sync worker: what the index holds as gone, which a listing that
    // lags may still return.
    goneStableIds(workspaceId: Ulid, source: SourceKind): string[] {
      return selectGoneIds.all(workspaceId, source).map((row) => String(row.stable_id));
    },

    source(
      workspaceId: Ulid,
      kind: SourceKind,
    ): { cursor: string | null; syncedAt: Instant | null } | null {
      const raw = selectSource.get(workspaceId, kind);
      if (!raw) return null;
      const row = sourceRow(raw);
      if (!row.ok) throw new Error(`corrupt sources row: ${JSON.stringify(row.issues)}`);
      return { cursor: row.value.cursor, syncedAt: row.value.synced_at };
    },
  };
}
