import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type IndexRecord,
  type Instant,
  instant,
  nullable,
  number,
  object,
  ulid,
} from "@oriel/core";
import { indexStore } from "./index-store.ts";
import { loadMigrations, migrate } from "./migrate.ts";
import { open } from "./open.ts";
import { ensureWorkspace } from "./workspaces.ts";

const t0 = instant(new Date(Date.UTC(2026, 9, 29, 9)));
const t1 = instant(new Date(Date.UTC(2026, 9, 29, 10)));
const attrs = object({ points: nullable(number) });

function fresh() {
  const db = open(":memory:");
  migrate(db, loadMigrations(), t0);
  const workspaceId = ulid(0, new Uint8Array(10));
  ensureWorkspace(db, { id: workspaceId, name: "test" }, t0);
  const index = indexStore(db);
  const sync = (
    pages: { records: IndexRecord<"jira">[]; gone?: string[]; texts?: Record<string, string> }[],
    now: Instant = t1,
  ) => {
    const run = index.beginSync(workspaceId, "jira", attrs, now);
    for (const p of pages)
      run.apply({ records: p.records, gone: p.gone ?? [], cursor: "c", texts: p.texts ?? {} });
    return run.finish("c", now);
  };
  const ids = () => index.records(workspaceId, "jira", attrs).map((r) => r.id);
  return { index, workspaceId, sync, ids };
}

function record(
  stableId: string,
  key: string,
  title: string,
  points: number | null = null,
): IndexRecord<"jira"> {
  return {
    id: `jira:${key}`,
    stableId,
    title,
    location: `https://oriel.atlassian.net/browse/${key}`,
    updatedAt: t0,
    facets: {},
    attrs: { points },
  };
}

test("a sync that crashed partway is reclaimed by the next one", () => {
  const { index, workspaceId, sync } = fresh();
  const crashed = index.beginSync(workspaceId, "jira", attrs, t0);
  crashed.apply({ records: [record("10001", "SYN-1", "A")], gone: [], cursor: "c" });
  assert.equal(index.snapshot(workspaceId), 0);
  assert.equal(sync([{ records: [record("10001", "SYN-1", "A")] }]), 1);
});

test("an item that moves projects keeps its identity and takes its new handle", () => {
  const { index, workspaceId, sync } = fresh();
  sync([{ records: [record("10001", "SYN-1", "Checkout retries")] }]);
  sync([{ records: [record("10001", "OA-7", "Checkout retries")] }]);
  assert.deepEqual(
    index.records(workspaceId, "jira", attrs).map((r) => [r.stableId, r.id]),
    [["10001", "jira:OA-7"]],
  );
});

test("gone items become tombstones, and come back if the source returns them", () => {
  const { index, workspaceId, sync, ids } = fresh();
  sync([{ records: [record("10001", "SYN-1", "A"), record("10002", "SYN-2", "B")] }]);
  assert.equal(sync([{ records: [], gone: ["10002"] }]), 2);
  assert.deepEqual(index.liveStableIds(workspaceId, "jira"), ["10001"]);
  assert.deepEqual(ids(), ["jira:SYN-1"]);
  assert.equal(sync([{ records: [], gone: ["10002"] }]), 2);
  sync([{ records: [record("10002", "SYN-2", "B")] }]);
  assert.deepEqual(ids(), ["jira:SYN-1", "jira:SYN-2"]);
});

test("a recreated project reusing a key retires the old item instead of jamming sync", () => {
  const { index, workspaceId, sync, ids } = fresh();
  sync([{ records: [record("10001", "SYN-1", "Old story")] }]);
  sync([{ records: [record("20001", "SYN-1", "New story")] }]);
  assert.deepEqual(ids(), ["jira:SYN-1"]);
  assert.deepEqual(index.liveStableIds(workspaceId, "jira"), ["20001"]);
  sync([{ records: [], gone: ["20001"] }]);
  sync([{ records: [record("30001", "SYN-1", "Third story")] }]);
  assert.deepEqual(index.liveStableIds(workspaceId, "jira"), ["30001"]);
});

test("malformed pages are refused before they reach the index", () => {
  const { index, workspaceId } = fresh();
  const run = index.beginSync(workspaceId, "jira", attrs, t0);
  const bad = [
    { ...record("1", "SYN-1", "x"), id: "slack:C1" },
    { ...record("1", "SYN-1", "x"), id: "jira:syn 1" },
    { ...record("1", "SYN-1", "x"), updatedAt: "2026-10-29T09:00:00Z" },
    { ...record("1", "SYN-1", "x"), stableId: "" },
  ] as unknown as IndexRecord<"jira">[];
  for (const r of bad)
    assert.throws(() => run.apply({ records: [r], gone: [], cursor: "c" }), JSON.stringify(r));
  assert.deepEqual(index.records(workspaceId, "jira", attrs), []);
});

test("attrs are checked on write, so one bad record can't blank the window", () => {
  const { index, workspaceId, ids, sync } = fresh();
  sync([{ records: [record("1", "SYN-1", "ok", 3)] }]);
  const run = index.beginSync(workspaceId, "jira", attrs, t1);
  const bad = {
    ...record("2", "SYN-2", "bad"),
    attrs: { points: "5" },
  } as unknown as IndexRecord<"jira">;
  assert.throws(() => run.apply({ records: [bad], gone: [], cursor: "c" }));
  assert.deepEqual(ids(), ["jira:SYN-1"]);
});

test("facets are checked on write, like attrs", () => {
  const { index, workspaceId, ids, sync } = fresh();
  sync([{ records: [record("1", "SYN-1", "ok")] }]);
  const run = index.beginSync(workspaceId, "jira", attrs, t1);
  for (const facets of [
    { state: "stuck" },
    { container: { id: "SYN-1", stableId: "10001" } },
    { people: [{ id: "amara" }] },
  ]) {
    const bad = { ...record("2", "SYN-2", "bad"), facets } as unknown as IndexRecord<"jira">;
    assert.throws(
      () => run.apply({ records: [bad], gone: [], cursor: "c" }),
      Error,
      JSON.stringify(facets),
    );
  }
  assert.deepEqual(ids(), ["jira:SYN-1"]);
});

test("search work is bounded however the query is built", () => {
  const { index, workspaceId, sync } = fresh();
  sync([
    {
      records: Array.from({ length: 60 }, (_, i) =>
        record(`${i + 1}`, `SYN-${i + 1}`, `Story ${i}`),
      ),
    },
  ]);
  assert.equal(index.search(workspaceId, "story ".repeat(1_000_000), 10).length, 10);
  assert.equal(index.search(workspaceId, "story", Infinity).length, 50);
  assert.equal(index.search(workspaceId, "story", -5).length, 1);
  assert.equal(index.search(workspaceId, "story", Number.NaN).length, 1);
});

test("what anyone types is words, never the full-text query's syntax", () => {
  const { index, workspaceId, sync } = fresh();
  sync([
    {
      records: [
        record("1", "SYN-1", "Salt and pepper"),
        record("2", "SYN-2", "Title pepper notes"),
        record("3", "SYN-3", "Salt only"),
      ],
      texts: { "3": 'near the "quay" ^first' },
    },
  ]);
  const found = (q: string) =>
    index
      .search(workspaceId, q, 10)
      .map((r) => r.id)
      .sort();
  // As syntax, "-pepper" would leave pepper out, and "title:pepper" read a column.
  assert.deepEqual(found("salt -pepper"), ["jira:SYN-1"]);
  assert.deepEqual(found("title:pepper"), ["jira:SYN-2"]);
  assert.deepEqual(found("salt AND"), ["jira:SYN-1"]);
  assert.deepEqual(found("salt OR pepper"), []);
  assert.deepEqual(found("salt NOT pepper"), []);
  assert.deepEqual(found("NEAR(salt pepper)"), []);
  assert.deepEqual(found('"quay'), ["jira:SYN-3"]);
  assert.deepEqual(found('quay" OR "salt'), []);
  assert.deepEqual(found("^first"), ["jira:SYN-3"]);
  assert.deepEqual(found("{key}:syn-1"), []);
  assert.deepEqual(found("pep*"), ["jira:SYN-1", "jira:SYN-2"]);
  for (const q of [
    "AND",
    "OR",
    "NOT",
    "NEAR",
    "*",
    '"',
    '""',
    "-",
    "(",
    ")",
    ":",
    "^",
    "a\u0000b",
    "+",
  ])
    assert.doesNotThrow(() => index.search(workspaceId, q, 10), q);
  assert.deepEqual(found("*"), []);
});

test("the migration indexes the items already there, and only the live ones", () => {
  const db = open(":memory:");
  const migrations = loadMigrations();
  const before = migrations.findIndex((m) => m.name === "item_search");
  assert.ok(before > 0);
  migrate(db, migrations.slice(0, before), t0);
  const workspaceId = ulid(0, new Uint8Array(10));
  ensureWorkspace(db, { id: workspaceId, name: "test" }, t0);
  const item = db.prepare(`
    insert into items (workspace_id, source, stable_id, item_id, title, location, updated_at,
      attrs, snapshot, gone_at, text)
    values (?, ?, ?, ?, ?, 'https://example.com', ?, '{}', 1, ?, ?)`);
  item.run(workspaceId, "jira", "1", "jira:SYN-1", "Café rota", t0, null, "Night crossings");
  item.run(workspaceId, "jira.2", "2", "jira.2:ACME-4", "Billing", t0, null, null);
  item.run(workspaceId, "jira", "3", "jira:SYN-3", "Café gone", t0, t0, "Night crossings");
  migrate(db, migrations, t0);
  const index = indexStore(db);
  const found = (q: string) => index.search(workspaceId, q, 10).map((r) => r.id);
  assert.deepEqual(found("cafe night"), ["jira:SYN-1"]);
  assert.deepEqual(found("jira.2:acme-4"), ["jira.2:ACME-4"]);
  assert.deepEqual(found("jira"), []);
});
