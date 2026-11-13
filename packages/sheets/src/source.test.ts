import assert from "node:assert/strict";
import { test } from "node:test";
import type { SyncPage } from "@oriel/core";
import {
  type RowContent,
  rowKey,
  type SheetsAttrs,
  type SheetsRecord,
  type SpreadsheetContent,
  spreadsheetKey,
  spreadsheetPart,
  tabPart,
} from "./attrs.ts";
import { fixtureMappings, fixturePicks } from "./declared-fixture.ts";
import { loadSheetsFixture, type SheetsFixture } from "./fixture.ts";
import { googleReads } from "./google.ts";
import type { SheetsPicks, TabMapping } from "./mapping.ts";
import { maxRows, sheetsSource } from "./source.ts";
import { fixtureGoogle, type StandInOptions } from "./stand-in.ts";

const fixture = loadSheetsFixture();
const idOf = (slug: string) => {
  const found = fixture.spreadsheets.find((s) => s.slug === slug);
  assert.ok(found, slug);
  return found.id;
};
const tracker = idOf("tracker");
const raid = idOf("raid");
const contacts = idOf("contacts");
const archive = idOf("archive");

function connect(
  options: { picks?: SheetsPicks; standIn?: StandInOptions; fixture?: SheetsFixture } = {},
) {
  const standIn = fixtureGoogle(options.fixture ?? fixture, options.standIn);
  const waits: number[] = [];
  const google = googleReads({
    fetch: standIn.fetch,
    wait: async () => {},
    random: () => 0.5,
    waiting: (ms) => waits.push(ms),
  });
  const logged: string[] = [];
  const source = sheetsSource({
    google,
    picks: options.picks ?? fixturePicks(fixture),
    log: (message) => logged.push(message),
  });
  const sync = async (cursor: string | null = null) => {
    const pages: SyncPage<"sheets", SheetsAttrs>[] = [];
    for await (const page of source.sync(cursor)) pages.push(page);
    return {
      pages,
      records: pages.flatMap((p) => p.records),
      swept: pages.flatMap((p) => p.swept ?? []),
      held: pages.flatMap((p) => p.held ?? []),
      texts: Object.assign({}, ...pages.map((p) => p.texts ?? {})) as Record<string, string>,
      cursor: pages.at(-1)?.cursor ?? null,
    };
  };
  return { standIn, source, sync, waits, logged };
}

const only = (slug: string, tabs = fixtureMappings[slug] ?? []): SheetsPicks => ({
  spreadsheets: [{ id: idOf(slug), tabs }],
});
const rowsOf = (records: SheetsRecord[], sheetId: number) =>
  records.filter((r) => r.attrs.of === "row" && r.attrs.tab.sheetId === sheetId);
const row = (records: SheetsRecord[], spreadsheet: string, sheetId: number, key: string) =>
  records.find((r) => r.id === `sheets:${rowKey(spreadsheet, sheetId, key)}`);
const trackerMapping = (fixtureMappings.tracker ?? [])[0] as TabMapping;

test("a key is a hash of the spreadsheet, the tab and the key cell, and stable IDs start with their tab", async () => {
  const { sync } = connect({ picks: only("tracker", [trackerMapping]) });
  const { records } = await sync();
  const story = row(records, tracker, 1100, "FW-101");
  assert.ok(story);
  assert.match(story.id, /^sheets:[0-9a-f]{16}$/);
  assert.ok(!story.id.includes("FW-101"));
  assert.equal(story.stableId, `${tabPart(tracker, 1100)}${rowKey(tracker, 1100, "FW-101")}`);
  assert.equal(rowKey(tracker, 1100, "  FW-101 "), rowKey(tracker, 1100, "FW-101"));
  assert.notEqual(rowKey(tracker, 2141, "FW-101"), rowKey(tracker, 1100, "FW-101"));
});

test("two rows with one key and a row with none aren't items, and the report lists them by row number", async () => {
  const { source, sync } = connect({ picks: only("tracker", [trackerMapping]) });
  await sync();
  const tab = source.report().spreadsheets[0]?.tabs[0];
  assert.deepEqual(tab, {
    sheetId: 1100,
    title: "Tracker",
    duplicates: [5, 11],
    keyless: [12],
    hidden: 1,
    capped: false,
  });
});

test("an item past 50,000 characters is cut and says so", async () => {
  const long = structuredClone(fixture);
  const tab = long.spreadsheets.find((s) => s.slug === "tracker")?.tabs[0];
  assert.ok(tab);
  const cells = tab.rows[1];
  assert.ok(cells);
  cells[7] = "x".repeat(60_000);
  const cut = connect({ fixture: long, picks: only("tracker", [trackerMapping]) });
  const synced = await cut.sync();
  const first = row(synced.records, tracker, 1100, "FW-101");
  assert.ok(first);
  const [read] = await cut.source.read([first.id]);
  const content = read?.status === "ok" ? (read.content as RowContent) : null;
  assert.ok(content);
  assert.ok(content.text.length < 50_200);
  assert.ok(content.note);
});

test("a tab past the row cap reads its first 5,000 rows, and the report says it stopped there", async () => {
  const { source, sync } = connect({ picks: only("archive") });
  const { records } = await sync();
  assert.equal(rowsOf(records, 6100).length, maxRows);
  assert.equal(source.report().spreadsheets[0]?.tabs[0]?.capped, true);
  assert.equal(row(records, archive, 6100, "FW-A5000")?.title, "Explain the deck plan (5000)");
  assert.equal(row(records, archive, 6100, "FW-A5001"), undefined);
});

test("a tab sorted between versions keeps every item's ID; a renamed tab keeps them too", async () => {
  const { standIn, sync } = connect({ picks: only("tracker") });
  const before = await sync();
  const ids = (records: SheetsRecord[], sheetId: number) =>
    rowsOf(records, sheetId)
      .map((r) => r.id)
      .toSorted();
  standIn.advance(tracker);
  standIn.advance(tracker);
  standIn.advance(tracker);
  const after = await sync(before.cursor);
  assert.deepEqual(ids(after.records, 2142), ids(before.records, 2142));
  assert.deepEqual(ids(after.records, 2141), ids(before.records, 2141));
  const renamed = rowsOf(after.records, 2141)[0];
  assert.equal(renamed?.attrs.of === "row" && renamed.attrs.tab.title, "Sprint 41 (closed)");
});

test("a mapped column renamed or removed stops its tab, names the column, and holds what the index had", async () => {
  const renamed = structuredClone(fixture);
  const sheet = renamed.spreadsheets.find((s) => s.slug === "tracker");
  const header = sheet?.tabs[0]?.rows[0];
  assert.ok(header);
  header[4] = "Assignee";
  const { source, sync } = connect({ fixture: renamed, picks: only("tracker") });
  const { records, held, swept } = await sync();
  assert.deepEqual(rowsOf(records, 1100), []);
  assert.deepEqual(held, [tabPart(tracker, 1100)]);
  assert.deepEqual(swept, [spreadsheetPart(tracker)]);
  assert.ok(source.report().spreadsheets[0]?.tabs[0]?.stopped);
  assert.equal(rowsOf(records, 2141).length, 4);
});

test("a mapped header found twice stops its tab too", async () => {
  const twice = structuredClone(fixture);
  const header = twice.spreadsheets.find((s) => s.slug === "tracker")?.tabs[0]?.rows[0];
  assert.ok(header);
  header[7] = "Story";
  const { source, sync } = connect({ fixture: twice, picks: only("tracker", [trackerMapping]) });
  const { held } = await sync();
  assert.deepEqual(held, [tabPart(tracker, 1100)]);
  assert.ok(source.report().spreadsheets[0]?.tabs[0]?.stopped);
});

test("a spreadsheet that doesn't answer holds what the index had, and the sync goes on", async () => {
  const google = fixtureGoogle(fixture);
  const failing: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname.includes(raid)) return new Response("{}", { status: 500 });
    return google.fetch(input, init);
  };
  const source = sheetsSource({
    google: googleReads({
      fetch: failing,
      wait: async () => {},
      random: () => 0,
    }),
    picks: fixturePicks(fixture),
    log: () => {},
  });
  const pages = [];
  for await (const page of source.sync(null)) pages.push(page);
  assert.ok(pages.some((p) => p.held?.includes(spreadsheetPart(raid))));
  assert.ok(
    pages.some((p) =>
      p.records.some((r) => r.attrs.of === "row" && r.attrs.spreadsheet.id === contacts),
    ),
  );
  assert.equal(source.report().spreadsheets.find((s) => s.id === raid)?.problem, "failed");
});

test("the reader keeps only the tabs it asked for, even when Google answers with every tab", async () => {
  const { sync } = connect({
    picks: only("tracker", [trackerMapping]),
    standIn: { everyTab: true },
  });
  const { records } = await sync();
  assert.deepEqual(
    [...new Set(records.flatMap((r) => (r.attrs.of === "row" ? [r.attrs.tab.sheetId] : [])))],
    [1100],
  );
  assert.equal(rowsOf(records, 1100).length, 7);
});

test("a spreadsheet's comments past 50,000 characters aren't read, and its read says so", async () => {
  const chatty = structuredClone(fixture);
  const sheet = chatty.spreadsheets.find((s) => s.slug === "contacts");
  assert.ok(sheet);
  sheet.comments = Array.from({ length: 30 }, (_, n) => ({
    id: `AAAAlong${n}`,
    author: "Amara Okafor",
    content: "y".repeat(2_000),
    createdTime: "2026-09-10T08:45:00.000Z",
  }));
  const { source, sync } = connect({ fixture: chatty, picks: only("contacts") });
  await sync();
  const [read] = await source.read([`sheets:${spreadsheetKey(contacts)}`]);
  const content = read?.status === "ok" ? (read.content as SpreadsheetContent) : null;
  assert.ok(content);
  assert.ok(content.comments.length < 30);
  assert.ok(content.comments.reduce((n, c) => n + c.text.length, 0) <= 50_000);
  assert.ok(content.note);
});

test("a sparse tab read to the grid's end stops at the cap's rows, and says rows past them weren't read", async () => {
  const sparse = structuredClone(fixture);
  const tab = sparse.spreadsheets.find((s) => s.slug === "contacts")?.tabs[0];
  assert.ok(tab);
  tab.grid = { rows: 200_000, columns: 4 };
  tab.rows[150_000] = ["Far", "Away", "+44 1632 960999", "never"];
  const mapping: TabMapping = { ...(fixtureMappings.contacts?.[0] as TabMapping), end: "grid" };
  const { source, standIn, sync } = connect({
    fixture: sparse,
    picks: only("contacts", [mapping]),
  });
  const { records } = await sync();
  assert.equal(rowsOf(records, 5100).length, 2);
  assert.equal(source.report().spreadsheets[0]?.tabs[0]?.capped, true);
  assert.ok(standIn.calls.length < 20);
});
