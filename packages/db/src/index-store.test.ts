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
  // One complete sync of the given pages.
  const sync = (
    pages: { records: IndexRecord<"jira">[]; gone?: string[] }[],
    now: Instant = t1,
  ) => {
    const run = index.beginSync(workspaceId, "jira", now);
    for (const p of pages) run.apply({ records: p.records, gone: p.gone ?? [], cursor: "c" });
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
    url: `https://oriel.atlassian.net/browse/${key}`,
    updatedAt: t0,
    attrs: { points },
  };
}

test("a sync lands in the index as one snapshot version", () => {
  const { index, workspaceId, sync } = fresh();
  assert.equal(index.snapshot(workspaceId), 0);
  const version = sync([
    { records: [record("10001", "SYN-1", "Checkout retries", 3)] },
    { records: [record("10002", "SYN-2", "Banner")] },
  ]);
  assert.equal(version, 1);
  assert.deepEqual(
    index.records(workspaceId, "jira", attrs).map((r) => [r.id, r.title, r.attrs.points]),
    [
      ["jira:SYN-1", "Checkout retries", 3],
      ["jira:SYN-2", "Banner", null],
    ],
  );
  assert.deepEqual(index.source(workspaceId, "jira"), { cursor: "c", syncedAt: t1 });
});

test("a sync that changes nothing keeps the version", () => {
  const { sync } = fresh();
  sync([{ records: [record("10001", "SYN-1", "Checkout retries")] }]);
  assert.equal(sync([{ records: [record("10001", "SYN-1", "Checkout retries")] }]), 1);
  assert.equal(sync([{ records: [record("10001", "SYN-1", "Checkout retries v2")] }]), 2);
});

test("the sync time moves only when a sync finishes", () => {
  const { index, workspaceId, sync } = fresh();
  sync([{ records: [record("10001", "SYN-1", "A")] }], t0);
  const run = index.beginSync(workspaceId, "jira", t1);
  run.apply({ records: [record("10002", "SYN-2", "B")], gone: [], cursor: "c" });
  assert.equal(index.source(workspaceId, "jira")?.syncedAt, t0);
  run.finish("c", t1);
  assert.equal(index.source(workspaceId, "jira")?.syncedAt, t1);
});

test("a sync that crashed partway is reclaimed by the next one", () => {
  const { index, workspaceId, sync } = fresh();
  const crashed = index.beginSync(workspaceId, "jira", t0);
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
  const run = index.beginSync(workspaceId, "jira", t0);
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

test("search matches every term across scripts, accents and keys", () => {
  const { index, workspaceId, sync } = fresh();
  sync([
    {
      records: [
        record("1", "SYN-1", "Café checkout retries"),
        record("2", "SYN-2", "決済のリトライ"),
        record("3", "SYN-3", "Checkout copy ✨"),
        record("4", "SYN-4", "Retry banner"),
      ],
    },
  ]);
  const found = (q: string) => index.search(workspaceId, q, 10).map((r) => r.id);
  assert.deepEqual(found("cafe"), ["jira:SYN-1"]);
  assert.deepEqual(found("リトライ"), ["jira:SYN-2"]);
  assert.deepEqual(found("checkout retries"), ["jira:SYN-1"]);
  assert.deepEqual(found("syn-4"), ["jira:SYN-4"]);
  assert.deepEqual(found("CHECKOUT").sort(), ["jira:SYN-1", "jira:SYN-3"]);
  assert.deepEqual(found("jira"), []);
  assert.deepEqual(found("   "), []);
});

test("an exact key outranks keys that merely contain it", () => {
  const { index, workspaceId, sync } = fresh();
  const later = instant(new Date(Date.UTC(2026, 9, 30)));
  sync([
    {
      records: [
        record("1", "SYN-1", "First"),
        ...Array.from({ length: 12 }, (_, i) => ({
          ...record(`1${i}`, `SYN-1${i}`, `Other ${i}`),
          updatedAt: later,
        })),
      ],
    },
  ]);
  assert.deepEqual(
    index.search(workspaceId, "SYN-1", 1).map((r) => r.id),
    ["jira:SYN-1"],
  );
});

test("attrs that don't match the caller's shape are an error, not a silent cast", () => {
  const { index, workspaceId, sync } = fresh();
  sync([{ records: [record("1", "SYN-1", "x")] }]);
  assert.throws(
    () => index.records(workspaceId, "jira", object({ points: number })),
    /attrs don't match/,
  );
});
