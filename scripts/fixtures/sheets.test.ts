import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseBounds } from "../../packages/sheets/src/a1.ts";
import {
  applyChange,
  type FixtureCell,
  type FixtureTab,
  parseSheetsFixture,
  shown,
  valueOf,
} from "../../packages/sheets/src/fixture.ts";
import {
  archiveRows,
  contactsId,
  loadSheetsFixture,
  raidId,
  sheetsFixture,
  sheetsFixtureDir,
  sheetsFixtureFiles,
  sprint41,
  sprint42,
  trackerId,
  trackerTab,
} from "./sheets.ts";

test("fixtures/sheets/ is what the generator writes, and nothing else", () => {
  const files = sheetsFixtureFiles();
  assert.deepEqual(
    readdirSync(fileURLToPath(sheetsFixtureDir)).toSorted(),
    [...files.keys()].toSorted(),
  );
  for (const [name, text] of files)
    assert.equal(readFileSync(new URL(name, sheetsFixtureDir), "utf8"), text, name);
  assert.doesNotThrow(() => loadSheetsFixture());
});

const fixture = loadSheetsFixture();
const spreadsheet = (id: string) => {
  const found = fixture.spreadsheets.find((s) => s.id === id);
  assert.ok(found);
  return found;
};
const tab = (id: string, sheetId: number) => {
  const found = spreadsheet(id).tabs.find((t) => t.sheetId === sheetId);
  assert.ok(found);
  return found;
};
const column = (t: FixtureTab, header: string) => {
  const index = (t.rows[0] ?? []).indexOf(header);
  assert.ok(index >= 0, header);
  return t.rows.slice(1).map((row) => row[index]);
};
// The table: rows after the header, up to the first blank one.
const table = (t: FixtureTab) => {
  const blank = t.rows.findIndex((row, i) => i > 0 && row.every((c) => valueOf(c) === null));
  return t.rows.slice(1, blank === -1 ? undefined : blank);
};
const tabs = fixture.spreadsheets.flatMap((s) => s.tabs);
const cells = tabs.flatMap((t) => t.rows.flat());
const injection = /ignore (all )?(previous|your) instructions/i;

// SPEC §8's checklist for Google Sheets, case by case.
test("a tracker tab with an epic merged down its stories", () => {
  const tracker = tab(trackerId, trackerTab);
  const epic = parseBounds("B2:B5");
  assert.ok(tracker.merges?.includes("B2:B5") && epic);
  assert.equal(valueOf(tracker.rows[1]?.[1]), "Rebooking");
  for (const row of tracker.rows.slice(2, 5)) assert.equal(row[1], null);
});

test("a RAID log, and a plain table with no status", () => {
  const raid = spreadsheet(raidId).tabs[0];
  assert.ok(raid);
  assert.deepEqual(
    new Set(column(raid, "Type")),
    new Set(["Risk", "Assumption", "Issue", "Dependency"]),
  );
  const contacts = spreadsheet(contactsId).tabs[0];
  assert.ok(contacts);
  assert.ok(!(contacts.rows[0] ?? []).some((h) => /status/i.test(String(h))));
});

test("a notes block under a table, a duplicate key and a blank one", () => {
  const tracker = tab(trackerId, trackerTab);
  const rows = table(tracker);
  assert.ok(tracker.rows.length > rows.length + 2, "rows after the first blank one");
  const keys = rows.map((row) => valueOf(row[0]));
  assert.ok(keys.some((key, i) => key !== null && keys.indexOf(key) !== i));
  assert.ok(keys.includes(null));
});

test("a key edited, a tab sorted and a tab renamed between versions", () => {
  const changes = spreadsheet(trackerId).later.flatMap((v) => v.changes);
  assert.ok(
    changes.some((c) => c.kind === "set" && c.sheetId === trackerTab && c.cell.startsWith("A")),
  );
  assert.ok(changes.some((c) => c.kind === "sort" && c.sheetId === sprint42));
  assert.ok(changes.some((c) => c.kind === "rename" && c.sheetId === sprint41));
});

test("a row hidden by hand and one hidden by a filter, and a hidden column", () => {
  const tracker = tab(trackerId, trackerTab);
  assert.ok(tracker.hiddenRows?.length);
  assert.ok(tracker.filter);
  const { column: by, hiddenValues } = tracker.filter;
  const status = column(tracker, "Status");
  assert.equal(by, "D");
  assert.ok(status.some((c) => hiddenValues.includes(shown(c))));
  assert.ok(tracker.hiddenColumns?.length);
});

test("a formula cell and a text cell starting with =", () => {
  const isFormula = (c: FixtureCell) => typeof c === "object" && c?.formula !== undefined;
  assert.ok(cells.some(isFormula));
  assert.ok(cells.some((c) => typeof c === "string" && c.startsWith("=")));
});

test("a 10k-character cell, and numbers stored as text in a key column", () => {
  assert.ok(cells.some((c) => String(valueOf(c)).length >= 10_000));
  const tickets = column(tab(trackerId, sprint42), "Ticket");
  assert.ok(tickets.some((c) => typeof c === "string" && /^0[0-9]+$/.test(c)));
});

test("non-Latin and emoji headers and values, and two tabs with the same headers", () => {
  const headers = tabs.map((t) => (t.rows[0] ?? []).map(String));
  assert.ok(
    headers.flat().some((h) => /\p{Script=Han}|\p{Script=Katakana}|\p{Script=Greek}/u.test(h)),
  );
  assert.ok(headers.flat().some((h) => /\p{Extended_Pictographic}/u.test(h)));
  assert.ok(cells.some((c) => /\p{Script=Han}|\p{Script=Greek}/u.test(String(valueOf(c)))));
  const seen = headers.map((h) => JSON.stringify(h));
  assert.ok(seen.some((h, i) => seen.indexOf(h) !== i));
});

test("a tab past the row cap, and a spreadsheet the person can only view", () => {
  assert.ok(tabs.some((t) => t.rows.length - 1 > 5_000));
  assert.ok(archiveRows > 5_000);
  assert.equal(spreadsheet(contactsId).canEdit, false);
});

test("an injection in a cell, a header, a note, a comment, a tab's name and a title", () => {
  const notes = cells.flatMap((c) => (typeof c === "object" && c?.note ? [c.note] : []));
  assert.ok(
    tabs.some((t) =>
      t.rows
        .slice(1)
        .flat()
        .some((c) => injection.test(String(valueOf(c)))),
    ),
  );
  assert.ok(tabs.some((t) => (t.rows[0] ?? []).some((h) => injection.test(String(h)))));
  assert.ok(notes.some((n) => injection.test(n)));
  assert.ok(fixture.spreadsheets.some((s) => s.comments.some((c) => injection.test(c.content))));
  assert.ok(tabs.some((t) => injection.test(t.title)));
  assert.ok(fixture.spreadsheets.some((s) => injection.test(s.title)));
});

test("a sort moves whole rows by the column, A to Z; it refuses a range with a merge", () => {
  const copy = structuredClone(spreadsheet(trackerId));
  assert.equal(
    applyChange(copy, { kind: "sort", sheetId: sprint42, range: "A2:E6", column: "C" }),
    null,
  );
  const sorted = copy.tabs.find((t) => t.sheetId === sprint42);
  assert.deepEqual(
    sorted?.rows.slice(1).map((row) => [row[0], row[2]]),
    [
      ["00424", "Amara Okafor"],
      ["00422", "Bastian Holm"],
      ["00425", "Chen Yuting"],
      [423, "Esme Whitlock"],
      ["00421", "Farid Haddad"],
    ],
  );
  assert.equal(
    applyChange(copy, { kind: "sort", sheetId: trackerTab, range: "A2:I12", column: "A" }),
    "a sorted range can't hold a merge",
  );
});

test("Google's guarantees: unique IDs and tab names, merges, grids and newer versions", () => {
  const base = sheetsFixture();
  const [first] = base.spreadsheets;
  assert.ok(first);
  const [tracker, second] = first.tabs;
  assert.ok(tracker && second);
  const broken = [
    { ...first, tabs: [tracker, { ...second, sheetId: tracker.sheetId }] },
    { ...first, tabs: [tracker, { ...second, title: tracker.title.toUpperCase() }] },
    {
      ...first,
      tabs: [{ ...tracker, rows: tracker.rows.map((r, i) => (i === 2 ? ["x", "y"] : r)) }],
    },
    { ...first, tabs: [{ ...tracker, merges: ["B2:B5", "B4:B6"] }] },
    { ...first, tabs: [{ ...tracker, hiddenRows: [0] }] },
    { ...first, tabs: [{ ...tracker, rows: [[{ formula: "SUM(A1:A2)", value: 1 }]] }] },
    {
      ...first,
      later: [{ version: first.version, modifiedTime: first.modifiedTime, changes: [] }],
    },
    {
      ...first,
      later: [
        {
          version: "999",
          modifiedTime: first.modifiedTime,
          changes: [{ kind: "rename" as const, sheetId: tracker.sheetId, title: second.title }],
        },
      ],
    },
  ];
  for (const s of broken)
    assert.equal(
      parseSheetsFixture({ ...base, spreadsheets: [s] }).ok,
      false,
      JSON.stringify(s).slice(0, 80),
    );
  assert.equal(parseSheetsFixture({ ...base, spreadsheets: [first, first] }).ok, false);
});
