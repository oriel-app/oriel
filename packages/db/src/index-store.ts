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

export type SyncCounts = { new: number; changed: number; removed: number };

// Run one sync at a time per workspace.
export function indexStore(db: DatabaseSync) {
  const retireHandle = db.prepare(`
    update items set gone_at = ?, snapshot = ?, text = null
    where workspace_id = ? and item_id = ? and stable_id is not ? and gone_at is null`);
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
  const keepText = db.prepare(`
    update items set text = ? where workspace_id = ? and source = ? and stable_id = ?
      and text is not ?`);
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
  // FTS5 flushes what it holds at every later statement that could stop partway (an upsert, a trigger,
  // an insert from a select), so it's written last, one row a statement: any other way doubles a full sync.
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
  const selectSince = db.prepare(
    "select max(version) as version from snapshots where workspace_id = ? and source = ?",
  );
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

  const selectOwn = db.prepare(
    "select content from own_items where workspace_id = ? and source = ? and stable_id = ?",
  );
  const upsertOwn = db.prepare(`
    insert into own_items (workspace_id, source, stable_id, content) values (?, ?, ?, ?)
    on conflict (workspace_id, source, stable_id) do update set content = excluded.content`);
  const deleteOwn = db.prepare(
    "delete from own_items where workspace_id = ? and source = ? and stable_id = ?",
  );
  const selectKeys = db.prepare(
    "select item_id from items where workspace_id = ? and source = ? order by item_id",
  );

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

  // Read and checked once after each write rather than per request: the overview, Browse and the Jira
  // view each read them all. Frozen, since every reader shares them; each gets its own array.
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

  const readBack = (r: IndexRecord): IndexRecord => {
    const checked = facets(JSON.parse(JSON.stringify(r.facets)), "$.facets");
    return checked.ok ? { ...r, facets: checked.value } : r;
  };

  // Checked as reads check rows, attrs after a JSON round trip, so one bad record can't break the window later.
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

  const store = {
    snapshot,

    records<A>(
      workspaceId: Ulid,
      source: SourceKind,
      attrs: Validator<A>,
    ): IndexRecord<SourceKind, A>[] {
      return live(workspaceId, source, attrs);
    },

    // A crash partway leaves pages tagged with an unclaimed version, which the next sync reclaims.
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

    changes(workspaceId: Ulid, after = 0): ChangeLogEntry[] {
      const kept = logged.get(workspaceId) ?? readChanges(workspaceId);
      logged.set(workspaceId, kept);
      return kept.filter((entry) => entry.seq > after);
    },

    // Filtered before ranking, so a source the workspace no longer reads can't crowd out the rest.
    search(
      workspaceId: Ulid,
      query: string,
      limit: number,
      sources?: readonly SourceKind[],
    ): (IndexRecord<SourceKind, unknown> & { excerpt?: string })[] {
      const { terms, hits } = found(workspaceId, query, sources);
      return ranked(hits, terms, limit, writtenText(workspaceId));
    },

    matches(workspaceId: Ulid, query: string): ReadonlyMap<ItemId, "title" | "text"> {
      return new Map(found(workspaceId, query).hits.map((hit) => [hit.record.id, hit.matched]));
    },

    liveStableIds(workspaceId: Ulid, source: SourceKind): string[] {
      return selectLiveIds.all(workspaceId, source).map((row) => String(row.stable_id));
    },

    // A listing that lags may still return what the index holds as gone.
    goneStableIds(workspaceId: Ulid, source: SourceKind): string[] {
      return selectGoneIds.all(workspaceId, source).map((row) => String(row.stable_id));
    },

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

    // Nothing syncs a stand-in's own items, so run `write` between syncs, as a sync is run.
    own<A>(workspaceId: Ulid, source: SourceKind, attrs: Validator<A>, declared?: DeclaredFacets) {
      return {
        write: (
          page: Omit<IndexPage, "cursor">,
          contents: Readonly<Record<string, unknown>>,
          at: Instant,
        ): number =>
          transaction(db, () => {
            const run = store.beginSync(workspaceId, source, attrs, at, declared);
            run.apply({ ...page, cursor: null });
            for (const [stableId, content] of Object.entries(contents))
              upsertOwn.run(workspaceId, source, stableId, JSON.stringify(content));
            for (const stableId of page.gone) deleteOwn.run(workspaceId, source, stableId);
            return run.finish(null, at);
          }),
        content: (stableId: string): unknown => {
          const raw = selectOwn.get(workspaceId, source, stableId);
          return raw && typeof raw.content === "string" ? JSON.parse(raw.content) : null;
        },
        // Gone ones too, so no key is given twice.
        keys: (): string[] =>
          selectKeys
            .all(workspaceId, source)
            .map((row) => parseItemId(String(row.item_id))?.key ?? ""),
      };
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
  return store;
}
