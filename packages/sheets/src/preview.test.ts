import assert from "node:assert/strict";
import { test } from "node:test";
import { instant, type PreviewTable, ulid } from "@oriel/core";
import { sheetsDeclaredFixture } from "./declared-fixture.ts";
import { loadSheetsFixture } from "./fixture.ts";
import { sheetsOptions } from "./mapping.ts";
import { sheetsReview } from "./preview.ts";

const fixture = loadSheetsFixture();
const idOf = (slug: string) => fixture.spreadsheets.find((s) => s.slug === slug)?.id ?? "";
const tracker = idOf("tracker");
const raid = idOf("raid");
const now = instant(new Date(Date.UTC(2026, 10, 3, 9)));
const via = { kept: true, log: () => {}, now: () => now };

// A connection just picked: the tracker and the RAID log, no tab mapped.
const picked = { spreadsheets: [tracker, raid].map((id) => ({ id, tabs: [] })) };
const connection = {
  id: ulid(1, new Uint8Array(10)),
  number: 1,
  prefix: "sheets",
  identity: fixture.user.permissionId,
  options: picked,
  secret: null,
};
const preview = () => sheetsDeclaredFixture.preview?.(connection, via) ?? Promise.resolve([]);
const tableOf = (tables: PreviewTable[], at: string) => {
  const found = tables.find((table) => table.at === at);
  assert.ok(found, at);
  return found;
};

test("a waiting connection's preview is each picked tab's first rows, under their letters, by ID", async () => {
  const tables = await preview();
  assert.deepEqual(
    tables.map((table) => table.at),
    [
      ...fixture.spreadsheets
        .find((s) => s.slug === "tracker")!
        .tabs.map((t) => `${tracker}/${t.sheetId}`),
      ...fixture.spreadsheets
        .find((s) => s.slug === "raid")!
        .tabs.map((t) => `${raid}/${t.sheetId}`),
    ],
  );
  const sheet = tableOf(tables, `${tracker}/1100`);
  assert.deepEqual(sheet.columns.slice(0, 4), ["A", "B", "C", "D"]);
  assert.deepEqual(sheet.rows[0]?.slice(0, 4), ["ID", "Epic", "Story", "Status"]);
  assert.equal(sheet.rows[1]?.[0], "FW-101");
  assert.ok(sheet.rows.length <= 30);
  // A picked spreadsheet with no mapping checks out, and waits.
  assert.equal(sheetsOptions(picked).ok, true);
  assert.equal(sheetsReview.waits(picked), true);
});

// The mapping a person would approve for the tracker's first tab, by
// letter.
const trackerDraft = {
  at: `${tracker}/1100`,
  header: 1,
  end: "blank" as const,
  hidden: false,
  key: "A",
  title: "C",
  status: "D",
  states: { todo: ["To do"], "in-progress": ["In progress", "Blocked"], done: ["Done"] },
  assignee: "E",
  estimate: "F",
  link: "G",
};

test("a draft by letter settles into options naming the headers above them", async () => {
  const tables = await preview();
  const settled = sheetsReview.settle({ tabs: [trackerDraft] }, tables, {
    ...picked,
    readOnly: true,
  });
  assert.ok(!("problem" in settled));
  assert.deepEqual(settled, {
    readOnly: true,
    spreadsheets: [
      {
        id: tracker,
        tabs: [
          {
            sheetId: 1100,
            header: 1,
            end: "blank",
            hidden: false,
            states: trackerDraft.states,
            key: "ID",
            title: "Story",
            status: "Status",
            assignee: "Owner",
            estimate: "Estimate",
            link: "Link",
          },
        ],
      },
      { id: raid, tabs: [] },
    ],
  });
  assert.ok(sheetsOptions(settled).ok);
});

test("a draft maps only the tabs it names, as its card draws them", async () => {
  const tables = await preview();
  const had = sheetsReview.settle({ tabs: [trackerDraft] }, tables, picked);
  assert.ok(!("problem" in had));
  const raidTab = {
    at: `${raid}/4100`,
    header: 1,
    end: "blank",
    hidden: false,
    key: "B",
    title: "C",
  };
  const settled = sheetsReview.settle({ tabs: [raidTab] }, tables, had);
  assert.ok(!("problem" in settled));
  const spreadsheets = settled["spreadsheets"] as { id: string; tabs: unknown[] }[];
  assert.deepEqual(spreadsheets.find((s) => s.id === tracker)?.tabs, []);
  assert.equal(spreadsheets.find((s) => s.id === raid)?.tabs.length, 1);
  assert.equal(sheetsReview.waits(settled), false);
  assert.equal(sheetsReview.waits(picked), true);
});

test("a draft that names what the sheet doesn't show settles into nothing, and says why", async () => {
  const tables = await preview();
  for (const [draft, says] of [
    [{ ...trackerDraft, link: "Z" }, /column Z has no header/],
    [{ ...trackerDraft, header: 31 }, /row 31 isn't in what Oriel read/],
    [{ ...trackerDraft, at: "1NotPickedAtAll000/1100" }, /isn't in the picked spreadsheets/],
  ] as const) {
    const settled = sheetsReview.settle({ tabs: [draft] }, tables, picked);
    assert.ok("problem" in settled);
    assert.match(String(settled.problem), says);
  }
  assert.equal(sheetsReview.draft({ tabs: [{ ...trackerDraft, key: "Story" }] }).ok, false);
});

test("Oriel's guess takes the first row as the header and the first column all present and unique as the key", async () => {
  const tables = await preview();
  const guessed = sheetsReview.guess(tables) as { tabs: Record<string, unknown>[] } | null;
  assert.ok(guessed && sheetsReview.draft(guessed).ok);
  const sheet = guessed.tabs.find((tab) => tab.at === `${tracker}/1100`);
  // The tracker's IDs repeat once and one row has none, so its stories key it.
  assert.deepEqual(sheet, {
    at: `${tracker}/1100`,
    header: 1,
    end: "blank",
    hidden: false,
    key: "C",
    title: "C",
  });
  assert.ok(!("problem" in sheetsReview.settle(guessed, tables, picked)));
});

test("Oriel draws a draft from the sheet: each column's letter, its header and the field it feeds", async () => {
  const tables = await preview();
  const drawn = sheetsReview.draw({ tabs: [trackerDraft] }, tables);
  assert.equal(drawn.length, tables.length);
  const sheet = drawn.find((table) => table.name.endsWith("› Tracker"));
  assert.ok(sheet);
  assert.deepEqual(sheet.columns.slice(0, 4), [
    { at: "A", header: "ID", feeds: "Key" },
    { at: "B", header: "Epic", feeds: null },
    { at: "C", header: "Story", feeds: "Title" },
    { at: "D", header: "Status", feeds: "Status" },
  ]);
  assert.equal(sheet.rows[0]?.[0], "FW-101");
  assert.ok(sheet.lines.some((line) => /first blank row/.test(line)));
  assert.ok(sheet.lines.some((line) => /In progress, Blocked are in progress/.test(line)));
  // The tabs it doesn't map aren't read.
  assert.ok(
    drawn.filter((table) => table !== sheet).every((table) => table.lines[0] === "Not read."),
  );
});

test("a mapped column gone from its header row makes the connection wait for options that fit", async () => {
  const mapped = sheetsReview.settle({ tabs: [trackerDraft] }, await preview(), picked);
  assert.ok(!("problem" in mapped));
  const spreadsheets = (mapped as typeof picked).spreadsheets.map((s) => ({
    ...s,
    tabs: s.tabs.map((tab) => ({ ...(tab as object), status: "Stage" })),
  }));
  const stale = { ...connection, options: { spreadsheets } };
  const opened = await sheetsDeclaredFixture.open(stale, via);
  let cursor: string | null = null;
  for await (const page of opened.source.sync(null)) cursor = page.cursor ?? cursor;
  assert.match(opened.unfit?.() ?? "", /the status column, "Stage", isn't in the header row/);
  // Opened again, as at the next start, its cursor reads that spreadsheet
  // again, so it still waits.
  const reopened = await sheetsDeclaredFixture.open(stale, via);
  for await (const page of reopened.source.sync(cursor)) assert.ok(page);
  assert.match(reopened.unfit?.() ?? "", /"Stage"/);
  const fits = await sheetsDeclaredFixture.open({ ...connection, options: mapped }, via);
  for await (const page of fits.source.sync(null)) assert.ok(page);
  assert.equal(fits.unfit?.(), null);
});
