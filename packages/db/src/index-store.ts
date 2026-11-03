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
  parseItemId,
  refine,
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
});
const versionRow = object({ version: nullable(number) });
const existsRow = object({ found: number });
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
// The connections records are from, by their IDs' prefixes.
export const prefixesOf = (records: readonly { id: string }[]): Set<string> =>
  new Set(records.flatMap((record) => parseItemId(record.id)?.prefix ?? []));

// A query as search() takes it: at most 256 characters and 8 distinct
// terms, folded, with the prefix of a connection in `prefixes` dropped from
// a term, so a full item ID, such as "jira:syn-12", works as a query. Text
// that only looks like one, such as "fix:login", stays as written. `whole`
// is the query as one key.
export function searchTerms(
  query: string,
  prefixes: ReadonlySet<string>,
): { terms: string[]; whole: string } {
  const keyOf = (term: string) => {
    const at = term.indexOf(":");
    return at > 0 && prefixes.has(term.slice(0, at)) ? term.slice(at + 1) : term;
  };
  const bounded = fold(query.slice(0, maxQueryChars));
  const stripped = bounded.split(/\s+/).map(keyOf).filter(Boolean);
  return {
    terms: [...new Set(stripped)].slice(0, maxTerms),
    whole: keyOf(bounded.trim()),
  };
}

// An item's key and title, folded, as search() matches them.
const searchable = (record: IndexRecord<SourceKind, unknown>) => ({
  key: fold(parseItemId(record.id)?.key ?? ""),
  title: fold(record.title),
});

// Whether every term is in the item's key or title: search()'s match, for
// Browse's item search too (decision 0027).
export function matchesSearch(record: IndexRecord<SourceKind, unknown>, terms: readonly string[]) {
  const { key, title } = searchable(record);
  const haystack = `${key} ${title}`;
  return terms.every((term) => haystack.includes(term));
}

// A record and everything in it, frozen.
function frozen<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const inner of Object.values(value)) frozen(inner);
  return Object.freeze(value);
}

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
  const written = () => {
    read.clear();
    logged.clear();
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
      const gone = (from: SourceKind, stableId: string) =>
        logChange.run(workspaceId, from, stableId, version, now, "{}", 1);
      return {
        version,
        apply(page: IndexPage): void {
          check(source, attrs, page);
          written();
          transaction(db, () => {
            for (const r of page.records) {
              const holder = selectHolder.get(workspaceId, r.id, r.stableId);
              retireHandle.run(now, version, workspaceId, r.id, r.stableId);
              const retired = holder && stableIdRow(holder);
              if (retired?.ok) gone(source, retired.value.stable_id);
              const stored = selectStored.get(workspaceId, source, r.stableId);
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
              if (tombstone.run(now, version, workspaceId, source, stableId).changes)
                gone(source, stableId);
            }
          });
        },
        finish(cursor: string | null, finishedAt: Instant): number {
          written();
          return transaction(db, () => {
            saveSource.run(workspaceId, source, cursor, finishedAt);
            pruneChanges.run(workspaceId, keptSince(finishedAt));
            pruneWaiting.run(workspaceId, keptSince(finishedAt));
            const changed = existsRow(changedIn.get(workspaceId, source, version));
            if (!changed.ok || !changed.value.found) return version - 1;
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

    // The escape hatch, across every source. Every term must appear in the
    // item's key or title; a "jira:" prefix on a term is dropped, so a full
    // item ID works as a query. An exact key comes first, then titles starting
    // with the first term, then the most recently updated. At most 256
    // characters, 8 distinct terms and 50 results.
    // Only the `sources` given, when given: a source the workspace no longer
    // reads is left out before ranking, so it can't crowd out the rest.
    search(
      workspaceId: Ulid,
      query: string,
      limit: number,
      sources?: readonly SourceKind[],
    ): IndexRecord<SourceKind, unknown>[] {
      const all = live(workspaceId, null, unknown);
      const { terms, whole } = searchTerms(query, prefixesOf(all));
      const first = terms[0];
      const count = Math.min(Math.max(Math.trunc(limit) || 0, 1), maxResults);
      if (!first) return [];
      return all
        .filter((record) => {
          const source = parseItemId(record.id)?.prefix;
          return !sources || (source !== undefined && sources.includes(source));
        })
        .filter((record) => matchesSearch(record, terms))
        .map((record) => ({ record, ...searchable(record) }))
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
