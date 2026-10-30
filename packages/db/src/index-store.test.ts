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
    const run = index.beginSync(workspaceId, "jira", attrs, now);
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
    location: `https://oriel.atlassian.net/browse/${key}`,
    updatedAt: t0,
    facets: {},
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
  const run = index.beginSync(workspaceId, "jira", attrs, t1);
  run.apply({ records: [record("10002", "SYN-2", "B")], gone: [], cursor: "c" });
  assert.equal(index.source(workspaceId, "jira")?.syncedAt, t0);
  run.finish("c", t1);
  assert.equal(index.source(workspaceId, "jira")?.syncedAt, t1);
});

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

test("attrs are checked on write, so one bad record can't blank the window", () => {
  const { index, workspaceId, ids, sync } = fresh();
  sync([{ records: [record("1", "SYN-1", "ok", 3)] }]);
  const run = index.beginSync(workspaceId, "jira", attrs, t1);
  const bad = {
    ...record("2", "SYN-2", "bad"),
    attrs: { points: "5" },
  } as unknown as IndexRecord<"jira">;
  assert.throws(() => run.apply({ records: [bad], gone: [], cursor: "c" }), /attrs don't match/);
  assert.deepEqual(ids(), ["jira:SYN-1"]);
});

test("facets are kept as given, absent ones stay absent, and a facet change is a change", () => {
  const { index, workspaceId, sync } = fresh();
  const facets = {
    people: [{ role: "assignee", id: "amara", name: "Amara Okafor" }],
    state: "in-progress" as const,
    container: { id: "jira:SYN-1" as const, stableId: "10001" },
  };
  sync([{ records: [{ ...record("2", "SYN-2", "Story"), facets }] }]);
  const [stored] = index.records(workspaceId, "jira", attrs);
  assert.deepEqual(stored?.facets, facets);
  assert.equal(Object.hasOwn(stored?.facets ?? {}, "links"), false);
  const moved = { ...facets, container: null };
  assert.equal(sync([{ records: [{ ...record("2", "SYN-2", "Story"), facets: moved }] }]), 2);
  assert.deepEqual(index.records(workspaceId, "jira", attrs)[0]?.facets, moved);
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
      /facets don't match/,
      JSON.stringify(facets),
    );
  }
  assert.deepEqual(ids(), ["jira:SYN-1"]);
});

test("search finds an item by its full item ID, ahead of newer near-misses", () => {
  const { index, workspaceId, sync } = fresh();
  const later = instant(new Date(Date.UTC(2026, 9, 30)));
  sync([
    {
      records: [
        record("1", "SYN-1", "First"),
        { ...record("2", "SYN-10", "Tenth"), updatedAt: later },
      ],
    },
  ]);
  assert.deepEqual(
    index.search(workspaceId, "jira:SYN-1", 1).map((r) => r.id),
    ["jira:SYN-1"],
  );
  assert.deepEqual(index.search(workspaceId, "jira:", 10), []);
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

test("only the first 8 distinct terms count, after prefixes are stripped", () => {
  const { index, workspaceId, sync } = fresh();
  sync([{ records: [record("1", "SYN-1", "a b c d e f g h")] }]);
  assert.equal(index.search(workspaceId, "a b c d e f g h nomatch", 10).length, 1);
  assert.equal(index.search(workspaceId, "jira:a a b c d e f g nomatch", 10).length, 0);
  assert.equal(index.search(workspaceId, "a b c d e f g nomatch", 10).length, 0);
});

test("only the first 256 characters of a query count", () => {
  const { index, workspaceId, sync } = fresh();
  sync([{ records: [record("1", "SYN-1", "Story")] }]);
  assert.equal(index.search(workspaceId, `story${" ".repeat(300)}nomatch`, 10).length, 1);
  assert.equal(index.search(workspaceId, `story${" ".repeat(100)}nomatch`, 10).length, 0);
});

test("a first sync with no pages still counts as a sync", () => {
  const { index, workspaceId } = fresh();
  const run = index.beginSync(workspaceId, "jira", attrs, t1);
  assert.equal(run.finish(null, t1), 0);
  assert.deepEqual(index.source(workspaceId, "jira"), { cursor: null, syncedAt: t1 });
  const next = index.beginSync(workspaceId, "jira", attrs, t1);
  next.finish("c2", t1);
  index.beginSync(workspaceId, "jira", attrs, t1).finish(null, t1);
  assert.equal(index.source(workspaceId, "jira")?.cursor, "c2");
});
