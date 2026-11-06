import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type IndexRecord,
  type Instant,
  instant,
  maxSearchText,
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
  assert.deepEqual(index.source(workspaceId, "jira"), {
    cursor: "c",
    syncedAt: t1,
    lastSync: { new: 2, changed: 0, removed: 0 },
  });
});

test("a sync keeps how many items it found new, changed and gone, and zeros when nothing changed", () => {
  const { index, workspaceId, sync } = fresh();
  const counts = () => index.source(workspaceId, "jira")?.lastSync;
  sync([{ records: [record("10001", "SYN-1", "A"), record("10002", "SYN-2", "B")] }]);
  sync([
    { records: [record("10001", "SYN-1", "A, renamed"), record("10003", "SYN-3", "C")] },
    // Listed twice, as a paging listing may, it is still one change.
    { records: [record("10001", "SYN-1", "A, renamed again")], gone: ["10002"] },
  ]);
  assert.deepEqual(counts(), { new: 1, changed: 1, removed: 1 });
  sync([{ records: [record("10001", "SYN-1", "A, renamed again")], gone: ["10002"] }]);
  assert.deepEqual(counts(), { new: 0, changed: 0, removed: 0 });
  // Back from gone is new again.
  sync([{ records: [record("10002", "SYN-2", "B")] }]);
  assert.deepEqual(counts(), { new: 1, changed: 0, removed: 0 });
});

test("an item new and gone in one sync counts as neither, and one that moves off a reused key is changed", () => {
  const { index, workspaceId, sync } = fresh();
  const counts = () => index.source(workspaceId, "jira")?.lastSync;
  sync([{ records: [record("10001", "SYN-1", "A")] }]);
  sync([{ records: [record("10002", "SYN-2", "B")], gone: ["10002"] }]);
  assert.deepEqual(counts(), { new: 0, changed: 0, removed: 0 });
  // SYN-1 moves to OA-7 and a new item takes SYN-1, listed first: the old
  // holder is retired, then comes back under its new handle.
  sync([
    { records: [record("10003", "SYN-1", "New story")] },
    { records: [record("10001", "OA-7", "A")] },
  ]);
  assert.deepEqual(counts(), { new: 1, changed: 1, removed: 0 });
  // A key reused by an item that replaced one deleted in the source.
  sync([{ records: [record("10004", "OA-7", "Another")] }]);
  assert.deepEqual(counts(), { new: 1, changed: 0, removed: 1 });
});

test("a sync that crashed partway counts what it applied once the next one finishes", () => {
  const { index, workspaceId, sync } = fresh();
  sync([{ records: [record("10001", "SYN-1", "A")] }]);
  const crashed = index.beginSync(workspaceId, "jira", attrs, t1);
  crashed.apply({ records: [record("10002", "SYN-2", "B")], gone: [], cursor: "c" });
  sync([{ records: [record("10001", "SYN-1", "A"), record("10002", "SYN-2", "B")] }]);
  assert.deepEqual(index.source(workspaceId, "jira")?.lastSync, { new: 1, changed: 0, removed: 0 });
});

test("a crashed sync's changes still count when another source finished before the next one", () => {
  const { index, workspaceId, sync } = fresh();
  sync([{ records: [record("10001", "SYN-1", "A"), record("10002", "SYN-2", "B")] }]);
  const crashed = index.beginSync(workspaceId, "jira", attrs, t1);
  crashed.apply({
    records: [record("10001", "SYN-1", "A, renamed"), record("10003", "SYN-3", "C")],
    gone: ["10002"],
    cursor: "c",
  });
  const other = index.beginSync(workspaceId, "folder", attrs, t1);
  other.apply({
    records: [{ ...record("f1", "SYN-9", "Notes"), id: "folder:f1" }],
    gone: [],
    cursor: null,
  });
  assert.equal(other.finish(null, t1), 2);
  sync([{ records: [record("10001", "SYN-1", "A, renamed"), record("10003", "SYN-3", "C")] }]);
  assert.deepEqual(index.source(workspaceId, "jira")?.lastSync, { new: 1, changed: 1, removed: 1 });
  assert.deepEqual(index.source(workspaceId, "folder")?.lastSync, {
    new: 1,
    changed: 0,
    removed: 0,
  });
});

test("a sync that changes nothing keeps the version", () => {
  const { sync } = fresh();
  sync([{ records: [record("10001", "SYN-1", "Checkout retries")] }]);
  assert.equal(sync([{ records: [record("10001", "SYN-1", "Checkout retries")] }]), 1);
  assert.equal(sync([{ records: [record("10001", "SYN-1", "Checkout retries v2")] }]), 2);
});

// The overview, Browse and the Jira view each read every record on every
// request, so the index reads them from the table once per write.
test("records are read once per write to the index, and every reader shares them, frozen", () => {
  const { index, workspaceId, sync, ids } = fresh();
  sync([{ records: [record("10001", "SYN-1", "A", 3), record("10002", "SYN-2", "B")] }]);
  const first = index.records(workspaceId, "jira", attrs);
  const again = index.records(workspaceId, "jira", attrs);
  assert.equal(again[0], first[0]);
  assert.ok(Object.isFrozen(first[0]) && Object.isFrozen(first[0]?.attrs));
  assert.throws(() => Object.assign(first[0] ?? {}, { title: "changed" }), TypeError);
  first.reverse();
  assert.deepEqual(ids(), ["jira:SYN-1", "jira:SYN-2"], "each reader's list is its own");
  const run = index.beginSync(workspaceId, "jira", attrs, t1);
  run.apply({ records: [record("10001", "SYN-1", "A, renamed", 3)], gone: ["10002"], cursor: "c" });
  assert.deepEqual(
    index.records(workspaceId, "jira", attrs).map((r) => [r.id, r.title]),
    [["jira:SYN-1", "A, renamed"]],
    "a page is read as soon as it lands",
  );
  run.finish("c", t1);
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

test("search finds an item by its text, after every key and title hit, with an excerpt", () => {
  const { index, workspaceId, sync } = fresh();
  const later = instant(new Date(Date.UTC(2026, 9, 30)));
  sync([
    {
      records: [
        record("1", "SYN-1", "Q3 launch: open questions"),
        { ...record("2", "SYN-2", "Fare rules"), updatedAt: later },
        { ...record("3", "SYN-3", "Waitlist"), updatedAt: later },
      ],
      texts: {
        "1": "- Do we waive the fare difference on every route, or only on the long crossings?",
        "3": "fare ".repeat(1000),
      },
    },
  ]);
  const found = index.search(workspaceId, "fare", 10);
  // A title hit first, however often a text repeats the word.
  assert.deepEqual(
    found.map((r) => r.id),
    ["jira:SYN-2", "jira:SYN-3", "jira:SYN-1"],
  );
  assert.equal(found[0]?.excerpt, undefined);
  assert.ok((found[1]?.excerpt ?? "").replace(/^…|…$/g, "").length <= 140);
  assert.deepEqual(
    index.search(workspaceId, "long crossings", 10).map((r) => [r.id, r.excerpt]),
    [["jira:SYN-1", "…on every route, or only on the long crossings?"]],
  );
  // A term in the title and one in the text.
  assert.deepEqual(
    index.search(workspaceId, "launch waive", 10).map((r) => r.id),
    ["jira:SYN-1"],
  );
});

test("an item keeps its text when a sync gives none, keeps only what search keeps, and loses it when gone", () => {
  const { index, workspaceId, sync } = fresh();
  sync([{ records: [record("1", "SYN-1", "One")], texts: { "1": "ferry timetable" } }]);
  sync([{ records: [{ ...record("1", "SYN-1", "One"), updatedAt: t1 }] }]);
  assert.deepEqual(
    index.search(workspaceId, "timetable", 10).map((r) => r.id),
    ["jira:SYN-1"],
  );
  sync([{ records: [record("1", "SYN-1", "One")], texts: { "1": "harbour" } }]);
  assert.deepEqual(index.search(workspaceId, "timetable", 10), []);
  sync([{ records: [], gone: ["1"] }]);
  assert.deepEqual(index.search(workspaceId, "harbour", 10), []);
  sync([
    {
      records: [record("2", "SYN-2", "Two")],
      texts: { "2": `${"x".repeat(maxSearchText - 6)} quay  beyond` },
    },
  ]);
  assert.equal(index.search(workspaceId, "quay", 10).length, 1);
  assert.deepEqual(index.search(workspaceId, "beyond", 10), []);
});

test("a text alone isn't a change: a sync that only gives texts counts nothing", () => {
  const { index, workspaceId, sync } = fresh();
  const first = sync([{ records: [record("1", "SYN-1", "One")] }]);
  const second = sync([{ records: [record("1", "SYN-1", "One")], texts: { "1": "harbour" } }]);
  assert.equal(second, first);
  assert.deepEqual(index.source(workspaceId, "jira")?.lastSync, { new: 0, changed: 0, removed: 0 });
  assert.deepEqual(
    index.search(workspaceId, "harbour", 10).map((r) => r.id),
    ["jira:SYN-1"],
  );
});

test("an item matches by its key and title, or with its text too, and every term must be somewhere", () => {
  const { index, workspaceId, sync } = fresh();
  sync([
    {
      records: [record("7", "SYN-7", "Rebooking fares")],
      texts: { "7": "Only on the long crossings. Café waivers." },
    },
  ]);
  const matched = (q: string) => index.matches(workspaceId, q).get("jira:SYN-7") ?? null;
  assert.equal(matched("syn-7 fares"), "title");
  assert.equal(matched("rebooking crossings"), "text");
  assert.equal(matched("cafe"), "text");
  assert.equal(matched("crossings sms"), null);
  assert.equal(matched(""), null);
  // A term finds the start of a word, as a thread's search does.
  assert.equal(matched("booking"), null);
  assert.equal(matched("rebook cross"), "text");
});

test("search folds the index as it folds the query, so résumé is resume, й is и, and a title's script needn't have spaces", () => {
  const { index, workspaceId, sync } = fresh();
  sync([
    {
      records: [
        record("1", "SYN-1", "Hiring"),
        record("2", "SYN-2", "Ночной рейс"),
        record("3", "SYN-3", "運航スケジュール"),
      ],
      texts: { "1": "Send the RÉSUMÉ to Dara", "2": "Мой рейс отменён", "3": "ガイドの更新" },
    },
  ]);
  const found = (q: string) => index.search(workspaceId, q, 10).map((r) => [r.id, r.excerpt]);
  assert.deepEqual(found("resume"), [["jira:SYN-1", "Send the RÉSUMÉ to Dara"]]);
  assert.deepEqual(found("résumé"), [["jira:SYN-1", "Send the RÉSUMÉ to Dara"]]);
  assert.deepEqual(found("мои"), [["jira:SYN-2", "Мой рейс отменён"]]);
  assert.deepEqual(found("スケジュール"), [["jira:SYN-3", undefined]]);
  assert.deepEqual(found("更新"), [["jira:SYN-3", "ガイドの更新"]]);
  // A voicing mark is kept: "ガ" isn't "カ".
  assert.deepEqual(found("ガイド"), [["jira:SYN-3", "ガイドの更新"]]);
  assert.deepEqual(found("カイト"), []);
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

test("search's index follows every way an item goes: gone, its handle taken, forgotten, and back", () => {
  const { index, workspaceId, sync } = fresh();
  const found = (q: string) => index.search(workspaceId, q, 10).map((r) => r.id);
  sync([{ records: [record("1", "SYN-1", "Harbour wall")], texts: { "1": "tide tables" } }]);
  // Another stable ID takes SYN-1's handle: the old one is retired.
  sync([{ records: [record("9", "SYN-1", "Ferry ramp")] }]);
  assert.deepEqual(found("harbour"), []);
  assert.deepEqual(found("tide"), []);
  assert.deepEqual(found("ramp"), ["jira:SYN-1"]);
  sync([{ records: [], gone: ["9"] }]);
  assert.deepEqual(found("ramp"), []);
  // Back from gone, with its title and the text it is given.
  sync([{ records: [record("9", "SYN-1", "Ferry ramp")], texts: { "9": "slipway" } }]);
  assert.deepEqual(found("ramp slipway"), ["jira:SYN-1"]);
  // A new key and title replace the old ones.
  sync([{ records: [record("9", "SYN-2", "Pier lights")] }]);
  assert.deepEqual(found("ramp"), []);
  assert.deepEqual(found("syn-2 pier slipway"), ["jira:SYN-2"]);
  index.forget(workspaceId, "jira", t1);
  assert.deepEqual(found("pier"), []);
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
  assert.deepEqual(index.source(workspaceId, "jira"), {
    cursor: null,
    syncedAt: t1,
    lastSync: { new: 0, changed: 0, removed: 0 },
  });
  const next = index.beginSync(workspaceId, "jira", attrs, t1);
  next.finish("c2", t1);
  index.beginSync(workspaceId, "jira", attrs, t1).finish(null, t1);
  assert.equal(index.source(workspaceId, "jira")?.cursor, "c2");
});
