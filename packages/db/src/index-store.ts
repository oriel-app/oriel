import type { DatabaseSync } from "node:sqlite";
import {
  type ChangeLogEntry,
  type DeclaredFacets,
  facetChanges,
  facetChangesShape,
  facets,
  type IndexRecord,
  type Instant,
  isInstant,
  isItemId,
  isPrefix,
  keptSince,
  literal,
  nullable,
  number,
  object,
  type Found,
  indexFold,
  matchQuery,
  maxSearchText,
  parseItemId,
  prefixesOf,
  ranked,
  refine,
  searchFold,
  searchTerms,
  type SourceKind,
  string,
  type IndexPage,
  type ItemId,
  type SyncPage,
  type Ulid,
  union,
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
  new_items: number,
  changed_items: number,
  removed_items: number,
});
const countsRow = object({
  rows: number,
  new_items: nullable(number),
  changed_items: nullable(number),
  removed_items: nullable(number),
});
const versionRow = object({ version: nullable(number) });
const textRow = object({ item_id: string, text: string });
const searchedRow = object({
  row: number,
  item_id: string,
  title: string,
  text: nullable(string),
});
const liveRow = object({
  row: number,
  item_id: refine(string, isItemId, "expected an item ID"),
});
const matchedRow = object({ row: number });
const stableIdRow = object({ stable_id: string });
const referenceRow = object({
  source: string,
  stable_id: string,
  to_id: refine(string, isItemId, "expected an item ID"),
  to_stable_id: string,
});
const changeRow = object({
  seq: number,
  source: refine(string, isPrefix, "expected a source"),
  stable_id: string,
  version: number,
  at: refine(string, isInstant, "expected an instant"),
  facets: string,
  gone: union(literal(0), literal(1)),
});

// A record and everything in it, frozen.
function frozen<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const inner of Object.values(value)) frozen(inner);
  return Object.freeze(value);
}

export type IndexStore = ReturnType<typeof indexStore>;

type Searchable = {
  byRow: ReadonlyMap<number, Omit<Found<IndexRecord>, "matched">>;
  prefixes: ReadonlySet<string>;
};

// What a source's last sync changed: items new to the index or back from
// gone, items it changed, and items gone from the source. A disconnect
// isn't a sync, and counts none.
export type SyncCounts = { new: number; changed: number; removed: number };

// The index the sync worker writes and the window, `search()` and the stale
// marker read. One complete sync of a source is one snapshot version. Run one
// sync at a time per workspace.
export function indexStore(db: DatabaseSync) {
  const retireHandle = db.prepare(`
    update items set gone_at = ?, snapshot = ?, text = null
    where workspace_id = ? and item_id = ? and stable_id is not ? and gone_at is null`);
  // A new item comes with its text, if the page gives one, so search's index
  // takes it in one write (migration 0028); an item already there takes it
  // from `keepText`.
  const upsert = db.prepare(`
    insert into items (workspace_id, source, stable_id, item_id, title, location, updated_at, facets, attrs, snapshot, added_in, text)
    values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, ?12)
    on conflict (workspace_id, source, stable_id) do update set
      item_id = excluded.item_id, title = excluded.title, location = excluded.location,
      updated_at = excluded.updated_at, facets = excluded.facets, attrs = excluded.attrs,
      snapshot = excluded.snapshot, gone_at = null,
      added_in = case when items.gone_at is not null and items.snapshot <= ?11
        then excluded.added_in else items.added_in end
    where items.item_id is not excluded.item_id or items.title is not excluded.title
      or items.location is not excluded.location or items.updated_at is not excluded.updated_at
      or items.facets is not excluded.facets or items.attrs is not excluded.attrs
      or items.gone_at is not null`);
  // The live item a record replaces, by stable ID, and the live item that
  // holds the record's handle under another stable ID.
  const selectStored = db.prepare(`
    select item_id, stable_id, title, location, updated_at, facets, attrs from items
    where workspace_id = ? and source = ? and stable_id = ? and gone_at is null`);
  const selectHolder = db.prepare(`
    select stable_id from items
    where workspace_id = ? and item_id = ? and stable_id is not ? and gone_at is null`);
  const logChange = db.prepare(`
    insert into change_log (seq, workspace_id, source, stable_id, version, at, facets, gone)
    values (
      1 + max(coalesce((select max(seq) from change_log), 0),
              coalesce((select max(seen_seq) from overview_seen), 0)),
      ?, ?, ?, ?, ?, ?, ?)`);
  const pruneChanges = db.prepare("delete from change_log where workspace_id = ? and at < ?");
  const selectChanges = db.prepare(`
    select seq, source, stable_id, version, at, facets, gone from change_log
    where workspace_id = ? order by seq`);
  const forgetReferences = db.prepare(
    "delete from item_references where workspace_id = ? and source = ? and stable_id = ?",
  );
  const liveByHandle = db.prepare(
    "select stable_id from items where workspace_id = ? and item_id = ? and gone_at is null",
  );
  const insertReference = db.prepare(`
    insert into item_references (workspace_id, source, stable_id, to_source, to_stable_id, to_handle, at)
    values (?, ?, ?, ?, ?, ?, ?)`);
  const resolveWaiting = db.prepare(`
    update item_references set to_stable_id = ?, to_handle = null
    where workspace_id = ? and to_source = ? and to_handle = ?`);
  const pruneWaiting = db.prepare(
    "delete from item_references where workspace_id = ? and to_handle is not null and at < ?",
  );
  const selectReferences = db.prepare(`
    select r.source, r.stable_id, i.item_id as to_id, i.stable_id as to_stable_id
    from item_references r join items i
      on i.workspace_id = r.workspace_id and i.source = r.to_source
        and i.stable_id = r.to_stable_id and i.gone_at is null
    where r.workspace_id = ? order by r.rowid`);
  // A record's text, written beside it without making it a change: a sync
  // that only gives a text the index lacked counts nothing.
  const keepText = db.prepare(`
    update items set text = ? where workspace_id = ? and source = ? and stable_id = ?
      and text is not ?`);
  // Each live item's rowid, which search's index finds it by, and the rows
  // a query matches there (migration 0028).
  const selectRows = db.prepare(
    "select rowid as row, item_id from items where workspace_id = ? and gone_at is null",
  );
  const selectMatched = db.prepare(
    "select rowid as row from item_search where item_search match ?",
  );
  const selectText = db.prepare(`
    select item_id, text from items
    where workspace_id = ? and item_id = ? and gone_at is null and text is not null`);
  const tombstone = db.prepare(`
    update items set gone_at = ?, snapshot = ?, text = null
    where workspace_id = ? and source = ? and stable_id = ? and gone_at is null`);
  // Search's full-text index (migration 0028), written in the same
  // transaction as the items it follows, after them, one row a statement: a
  // live item is in it as it ends up, and a gone one isn't. The table
  // flushes what it holds at every later statement in the transaction that
  // could stop partway, as an upsert, a trigger or an insert from a select
  // can, so writing it any other way doubles a full sync's time.
  const searchInsert = db.prepare(
    "insert into item_search (rowid, key, title, text) values (?, ?, ?, ?)",
  );
  const searchDelete = db.prepare("delete from item_search where rowid = ?");
  const selectSearched = db.prepare(`
    select rowid as row, item_id, title, text from items
    where workspace_id = ? and source = ? and stable_id = ? and gone_at is null`);
  const searchAdd = (row: number | bigint, id: string, title: string, text: string | null) =>
    searchInsert.run(
      row,
      indexFold(parseItemId(id)?.key ?? ""),
      indexFold(title),
      indexFold(text ?? ""),
    );
  // A live item, as search's index has it.
  const searched = (workspaceId: Ulid, source: SourceKind, stableId: string) => {
    const raw = selectSearched.get(workspaceId, source, stableId);
    if (!raw) return null;
    const row = searchedRow(raw);
    if (!row.ok) throw new Error(`corrupt index row: ${JSON.stringify(row.issues)}`);
    return row.value;
  };
  const searchForget = db.prepare(`
    delete from item_search where rowid in
      (select rowid from items where workspace_id = ? and source = ? and gone_at is null)`);
  // The version of a source's last sync that finished and changed something:
  // what its syncs since tagged, a crashed one's too, is theirs to claim.
  const selectSince = db.prepare(
    "select max(version) as version from snapshots where workspace_id = ? and source = ?",
  );
  // What the syncs since `?3` changed, from the items they tagged: live and
  // added since, new; live and added before, changed; gone, removed, unless
  // it was new since too. `rows` counts them all.
  const changedIn = db.prepare(`
    select count(*) as rows,
      sum(gone_at is null and added_in > ?3) as new_items,
      sum(gone_at is null and coalesce(added_in, 0) <= ?3) as changed_items,
      sum(gone_at is not null and coalesce(added_in, 0) <= ?3) as removed_items
    from items where workspace_id = ?1 and source = ?2 and snapshot > ?3`);
  const saveSource = db.prepare(`
    insert into sources (workspace_id, source, cursor, synced_at, new_items, changed_items, removed_items)
    values (?, ?, ?, ?, ?, ?, ?)
    on conflict (workspace_id, source) do update set
      cursor = coalesce(excluded.cursor, sources.cursor), synced_at = excluded.synced_at,
      new_items = excluded.new_items, changed_items = excluded.changed_items,
      removed_items = excluded.removed_items`);
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
    "select cursor, synced_at, new_items, changed_items, removed_items from sources where workspace_id = ? and source = ?",
  );

  // A disconnected connection's items, as decision 0049 has them forgotten.
  // References to them wait again by handle, from now, as one to an item the
  // index never had does.
  const forgetMade = db.prepare(
    "delete from item_references where workspace_id = ? and source = ?",
  );
  const forgetUnheld = db.prepare(`
    delete from item_references
    where workspace_id = ?1 and to_source = ?2 and to_stable_id is not null
      and not exists (select 1 from items i where i.workspace_id = ?1 and i.source = ?2
        and i.stable_id = item_references.to_stable_id)`);
  const waitAgain = db.prepare(`
    update item_references set at = ?3, to_stable_id = null, to_handle = (
      select substr(i.item_id, length(i.source) + 2) from items i
      where i.workspace_id = ?1 and i.source = ?2 and i.stable_id = item_references.to_stable_id)
    where workspace_id = ?1 and to_source = ?2 and to_stable_id is not null`);
  const forgetChanges = db.prepare("delete from change_log where workspace_id = ? and source = ?");
  const forgetState = db.prepare("delete from sources where workspace_id = ? and source = ?");
  const forgetItems = db.prepare("delete from items where workspace_id = ? and source = ?");

  const snapshot = (workspaceId: Ulid) => {
    const row = versionRow(selectLatest.get(workspaceId));
    return row.ok ? (row.value.version ?? 0) : 0;
  };

  const recordOf = <A>(raw: unknown, attrs: Validator<A>): IndexRecord<SourceKind, A> => {
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
  };

  // Each live item's resolved references, by its source and stable ID.
  const referencesOf = (workspaceId: Ulid) => {
    const by = new Map<string, { id: ItemId; stableId: string }[]>();
    for (const raw of selectReferences.all(workspaceId)) {
      const row = referenceRow(raw);
      if (!row.ok) throw new Error(`corrupt reference row: ${JSON.stringify(row.issues)}`);
      const key = `${row.value.source}\u0000${row.value.stable_id}`;
      const named = by.get(key) ?? [];
      named.push({ id: row.value.to_id, stableId: row.value.to_stable_id });
      by.set(key, named);
    }
    return by;
  };

  // The live records, read from the table and checked once after each write
  // to the index rather than on every request: the overview, Browse and
  // the Jira view each read them all. Frozen, since every reader shares
  // them; each gets its own array.
  const read = new Map<string, WeakMap<Validator<unknown>, readonly IndexRecord[]>>();
  const logged = new Map<string, readonly ChangeLogEntry[]>();
  const searchable = new Map<string, Searchable>();
  const written = () => {
    read.clear();
    logged.clear();
    searchable.clear();
  };
  const writtenText = (workspaceId: Ulid) => (id: ItemId) => {
    const row = textRow(selectText.get(workspaceId, id));
    return row.ok ? row.value.text : undefined;
  };
  const live = <A>(
    workspaceId: Ulid,
    source: SourceKind | null,
    attrs: Validator<A>,
  ): IndexRecord<SourceKind, A>[] => {
    const key = `${workspaceId}\u0000${source ?? ""}`;
    const kept = read.get(key)?.get(attrs);
    if (kept) return [...(kept as readonly IndexRecord<SourceKind, A>[])];
    const references = referencesOf(workspaceId);
    const records = selectLive.all(workspaceId, source, source).map((raw) => {
      const record = recordOf(raw, attrs);
      const named = references.get(`${parseItemId(record.id)?.prefix}\u0000${record.stableId}`);
      return frozen(
        named ? { ...record, facets: { ...record.facets, references: named } } : record,
      );
    });
    read.set(key, (read.get(key) ?? new WeakMap()).set(attrs, records));
    return [...records];
  };

  // What search ranks the live records by, by the rowid search's index
  // finds each by, and their prefixes: read on the first search after a
  // write, as the records are. Keys and titles only; texts stay on disk.
  const searchableOf = (workspaceId: Ulid): Searchable => {
    const kept = searchable.get(workspaceId);
    if (kept) return kept;
    const records = new Map(live(workspaceId, null, unknown).map((record) => [record.id, record]));
    const byRow = new Map<number, Omit<Found<IndexRecord>, "matched">>();
    for (const raw of selectRows.all(workspaceId)) {
      const row = liveRow(raw);
      if (!row.ok) throw new Error(`corrupt index row: ${JSON.stringify(row.issues)}`);
      const record = records.get(row.value.item_id);
      if (record)
        byRow.set(row.value.row, {
          record,
          key: searchFold(parseItemId(record.id)?.key ?? ""),
          title: searchFold(record.title),
        });
    }
    const made = { byRow, prefixes: prefixesOf([...records.values()]) };
    searchable.set(workspaceId, made);
    return made;
  };
  const rowsMatching = (match: string) =>
    selectMatched.all(match).map((raw) => {
      const row = matchedRow(raw);
      if (!row.ok) throw new Error(`corrupt search row: ${JSON.stringify(row.issues)}`);
      return row.value.row;
    });
  // Every live item that matches `query`, as `Found`, read from item_search
  // rather than any copy of the texts held here, with the terms it was
  // matched by. Only the `sources` given, when given.
  const found = (workspaceId: Ulid, query: string, sources?: readonly SourceKind[]) => {
    const { byRow, prefixes } = searchableOf(workspaceId);
    const terms = searchTerms(query, prefixes);
    const match = matchQuery(terms.terms);
    const hits: Found<IndexRecord>[] = [];
    if (!match) return { terms, hits };
    const titled = new Set(rowsMatching(match.titled));
    for (const row of rowsMatching(match.any)) {
      const item = byRow.get(row);
      const source = item && parseItemId(item.record.id)?.prefix;
      if (!item || (sources && (source === undefined || !sources.includes(source)))) continue;
      hits.push({ ...item, matched: titled.has(row) ? "title" : "text" });
    }
    return { terms, hits };
  };

  const readChanges = (workspaceId: Ulid): readonly ChangeLogEntry[] =>
    selectChanges.all(workspaceId).map((raw) => {
      const row = changeRow(raw);
      if (!row.ok) throw new Error(`corrupt change log row: ${JSON.stringify(row.issues)}`);
      const changed = facetChangesShape(JSON.parse(row.value.facets), "$.facets");
      if (!changed.ok)
        throw new Error(`corrupt change log facets: ${JSON.stringify(changed.issues)}`);
      return frozen({
        seq: row.value.seq,
        source: row.value.source,
        stableId: row.value.stable_id,
        version: row.value.version,
        at: row.value.at,
        facets: changed.value,
        gone: row.value.gone === 1,
      });
    });

  // A record as a read would return it: its facets in their checked shape.
  const readBack = (r: IndexRecord): IndexRecord => {
    const checked = facets(JSON.parse(JSON.stringify(r.facets)), "$.facets");
    return checked.ok ? { ...r, facets: checked.value } : r;
  };

  // Pages are checked the way reads check rows, attrs included after a JSON
  // round trip, so one bad record can't break the window later.
  const check = <A>(source: SourceKind, attrs: Validator<A>, page: SyncPage) => {
    for (const r of page.records) {
      if (parseItemId(r.id)?.prefix !== source) {
        throw new Error(`${JSON.stringify(r.id)} is not a ${source} item ID`);
      }
      if (!isInstant(r.updatedAt)) throw new Error(`${r.id}: updatedAt is not a canonical instant`);
      if (!r.stableId) throw new Error(`${r.id}: empty stable ID`);
      const checked = facets(JSON.parse(JSON.stringify(r.facets) ?? "null"), "$.facets");
      if (!checked.ok)
        throw new Error(`${r.id}: facets don't match: ${JSON.stringify(checked.issues)}`);
      if (checked.value.references !== undefined)
        throw new Error(`${r.id}: references are the index's to resolve, never a page's to set`);
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

    // Opens a sync of one source; `attrs` is that source's shape and
    // `declared` its declared facets. Each page commits on its own, with
    // what it changed in the change log: per item already indexed, the
    // facets that changed, and each item it tombstoned. `finish` takes the
    // snapshot version if anything changed, records the cursor (null keeps
    // the stored one) and the finish time, prunes the change log of what is
    // past keeping, and returns the version the index is at. A crash partway
    // leaves pages tagged with an unclaimed version, which the next sync
    // reclaims.
    beginSync<A>(
      workspaceId: Ulid,
      source: SourceKind,
      attrs: Validator<A>,
      now: Instant,
      declared: DeclaredFacets = {},
    ) {
      const version = snapshot(workspaceId) + 1;
      const last = versionRow(selectSince.get(workspaceId, source));
      const since = last.ok ? (last.value.version ?? 0) : 0;
      const gone = (from: SourceKind, stableId: string) =>
        logChange.run(workspaceId, from, stableId, version, now, "{}", 1);
      return {
        version,
        apply(page: IndexPage): void {
          check(source, attrs, page);
          written();
          const given = page.texts ?? {};
          const textOf = (stableId: string) =>
            Object.hasOwn(given, stableId) ? (given[stableId] ?? "").slice(0, maxSearchText) : null;
          transaction(db, () => {
            // What search's index drops, by rowid, and adds as it ends up,
            // by stable ID, once everything else is written. An item new or
            // back from gone in this page isn't in it to drop.
            const drops = new Set<number>();
            const adds = new Set<string>();
            const fresh = new Set<string>();
            const drop = (stableId: string) => {
              const item = fresh.has(stableId) ? null : searched(workspaceId, source, stableId);
              if (item) drops.add(item.row);
            };
            for (const r of page.records) {
              const holder = selectHolder.get(workspaceId, r.id, r.stableId);
              const retired = holder && stableIdRow(holder);
              if (retired?.ok) drop(retired.value.stable_id);
              retireHandle.run(now, version, workspaceId, r.id, r.stableId);
              if (retired?.ok) gone(source, retired.value.stable_id);
              const stored = selectStored.get(workspaceId, source, r.stableId);
              // New, or back from gone; or live, with a new key or title.
              const was = stored && itemRow(stored);
              if (!was) fresh.add(r.stableId);
              if (!was || !was.ok || was.value.item_id !== r.id || was.value.title !== r.title) {
                drop(r.stableId);
                adds.add(r.stableId);
              }
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
                since,
                textOf(r.stableId),
              );
              // Compared as the index reads both back.
              const changed =
                stored && facetChanges(declared, recordOf(stored, unknown), readBack(r));
              if (changed)
                logChange.run(
                  workspaceId,
                  source,
                  r.stableId,
                  version,
                  now,
                  JSON.stringify(changed),
                  0,
                );
            }
            for (const stableId of Object.keys(given)) {
              const text = textOf(stableId);
              if (keepText.run(text, workspaceId, source, stableId, text).changes) {
                drop(stableId);
                adds.add(stableId);
              }
            }
            for (const r of page.records) {
              const handle = parseItemId(r.id)?.key ?? "";
              resolveWaiting.run(r.stableId, workspaceId, source, handle);
            }
            for (const [stableId, named] of Object.entries(page.references ?? {})) {
              forgetReferences.run(workspaceId, source, stableId);
              const kept = new Set<string>();
              for (const id of named) {
                const to = parseItemId(id);
                if (!to) continue;
                const found = liveByHandle.get(workspaceId, id);
                const toStableId = found ? stableIdRow(found) : null;
                const resolved = toStableId?.ok ? toStableId.value.stable_id : null;
                if (resolved === stableId && to.prefix === source) continue;
                const key = `${to.prefix}\u0000${resolved ?? `handle\u0000${to.key}`}`;
                if (kept.has(key)) continue;
                kept.add(key);
                insertReference.run(
                  workspaceId,
                  source,
                  stableId,
                  to.prefix,
                  resolved,
                  resolved === null ? to.key : null,
                  now,
                );
              }
            }
            for (const stableId of page.gone) {
              forgetReferences.run(workspaceId, source, stableId);
              drop(stableId);
              if (tombstone.run(now, version, workspaceId, source, stableId).changes)
                gone(source, stableId);
            }
            for (const row of drops) searchDelete.run(row);
            for (const stableId of adds) {
              const item = searched(workspaceId, source, stableId);
              if (item) searchAdd(item.row, item.item_id, item.title, item.text);
            }
          });
        },
        finish(cursor: string | null, finishedAt: Instant): number {
          written();
          return transaction(db, () => {
            const counted = countsRow(changedIn.get(workspaceId, source, since));
            if (!counted.ok)
              throw new Error(`corrupt sync counts: ${JSON.stringify(counted.issues)}`);
            const { rows, new_items, changed_items, removed_items } = counted.value;
            saveSource.run(
              workspaceId,
              source,
              cursor,
              finishedAt,
              new_items ?? 0,
              changed_items ?? 0,
              removed_items ?? 0,
            );
            pruneChanges.run(workspaceId, keptSince(finishedAt));
            pruneWaiting.run(workspaceId, keptSince(finishedAt));
            if (rows === 0) return version - 1;
            insertSnapshot.run(workspaceId, version, source, finishedAt);
            return version;
          });
        },
      };
    },

    // The change log in the order it committed: everything kept, or only
    // what committed after the entry `after`, such as the last one the user
    // had seen (`lastSeen`). Read once after each write to the index, as the
    // records are.
    changes(workspaceId: Ulid, after = 0): ChangeLogEntry[] {
      const kept = logged.get(workspaceId) ?? readChanges(workspaceId);
      logged.set(workspaceId, kept);
      return kept.filter((entry) => entry.seq > after);
    },

    // The escape hatch, across every source: by key, title or text, title
    // hits first, a text hit with its excerpt, as core's `ranked` orders
    // them. Only the `sources` given, when given: a source the workspace no
    // longer reads is left out before ranking, so it can't crowd out the
    // rest.
    search(
      workspaceId: Ulid,
      query: string,
      limit: number,
      sources?: readonly SourceKind[],
    ): (IndexRecord<SourceKind, unknown> & { excerpt?: string })[] {
      const { terms, hits } = found(workspaceId, query, sources);
      return ranked(hits, terms, limit, writtenText(workspaceId));
    },

    // Every live item `query` finds, as search() finds them, by its ID, and
    // whether only its text matched: Browse's item search (decision 0027).
    matches(workspaceId: Ulid, query: string): ReadonlyMap<ItemId, "title" | "text"> {
      return new Map(found(workspaceId, query).hits.map((hit) => [hit.record.id, hit.matched]));
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

    // Forgets everything the index keeps of one connection's items, by its
    // prefix: the items, tombstones too, their change log, the references
    // they made and its sync state. Takes a snapshot version when it held
    // any item, and returns the version the index is at.
    forget(workspaceId: Ulid, source: string, now: Instant): number {
      written();
      return transaction(db, () => {
        forgetMade.run(workspaceId, source);
        forgetUnheld.run(workspaceId, source);
        waitAgain.run(workspaceId, source, now);
        forgetChanges.run(workspaceId, source);
        forgetState.run(workspaceId, source);
        searchForget.run(workspaceId, source);
        const version = snapshot(workspaceId);
        if (forgetItems.run(workspaceId, source).changes === 0) return version;
        insertSnapshot.run(workspaceId, version + 1, source, now);
        return version + 1;
      });
    },

    source(
      workspaceId: Ulid,
      source: string,
    ): { cursor: string | null; syncedAt: Instant | null; lastSync: SyncCounts } | null {
      const raw = selectSource.get(workspaceId, source);
      if (!raw) return null;
      const row = sourceRow(raw);
      if (!row.ok) throw new Error(`corrupt sources row: ${JSON.stringify(row.issues)}`);
      const { cursor, synced_at, new_items, changed_items, removed_items } = row.value;
      return {
        cursor,
        syncedAt: synced_at,
        lastSync: { new: new_items, changed: changed_items, removed: removed_items },
      };
    },
  };
}
