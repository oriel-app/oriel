import assert from "node:assert/strict";
import { test } from "node:test";
import { mappingPrint, sheetsPicks, type TabMapping } from "./mapping.ts";
import { type Cell, type Grid, tableOf } from "./table.ts";

const cell = (shown: string, note: string | null = null): Cell => ({ shown, number: null, note });
const grid = (rows: (string | null)[][], more: Partial<Grid> = {}): Grid => ({
  startRow: 0,
  rows: rows.map((row) => row.map((v) => (v === null ? null : cell(v)))),
  hiddenRows: new Set(),
  hiddenColumns: new Set(),
  merges: [],
  ...more,
});
const mapping: TabMapping = {
  sheetId: 1,
  header: 1,
  end: "blank",
  hidden: false,
  key: "ID",
  title: "Name",
};
const rowsOf = (table: ReturnType<typeof tableOf>) => {
  assert.ok(!("stopped" in table));
  return table.rows;
};

test("columns are found by their headers, wherever they moved, and empty headers read by letter", () => {
  const rows = rowsOf(
    tableOf(
      grid([
        ["Owner", "Name", "", "ID"],
        ["Dara", "One", "loose", "A-1"],
      ]),
      mapping,
    ),
  );
  assert.deepEqual(rows[0]?.cells, [
    { header: "Owner", value: "Dara", note: null },
    { header: "Name", value: "One", note: null },
    { header: "Column C", value: "loose", note: null },
    { header: "ID", value: "A-1", note: null },
  ]);
});

test("the table ends at its first blank row, or runs to the grid's end skipping blank rows", () => {
  const rows = [["ID", "Name"], ["A-1", "One"], [], ["A-2", "Two"]];
  assert.deepEqual(
    rowsOf(tableOf(grid(rows), mapping)).map((r) => r.key),
    ["A-1"],
  );
  assert.deepEqual(
    rowsOf(tableOf(grid(rows), { ...mapping, end: "grid" })).map((r) => r.key),
    ["A-1", "A-2"],
  );
});

test("a header row below the first, and a value merged across columns belonging to the leftmost", () => {
  const table = tableOf(
    grid([["Title block"], ["ID", "Name", "Extra"], ["A-1", "Wide", null]], {
      merges: [{ startRow: 2, endRow: 3, startColumn: 1, endColumn: 3 }],
    }),
    { ...mapping, header: 2 },
  );
  const [first] = rowsOf(table);
  assert.equal(first?.number, 3);
  assert.deepEqual(
    first?.cells.map((c) => c.header),
    ["ID", "Name"],
  );
});

test("a value merged down is on each row it covers, but its note stays on the first", () => {
  const rows = rowsOf(
    tableOf(
      {
        ...grid([
          ["ID", "Name", "Epic"],
          ["A-1", "One", null],
          ["A-2", "Two", null],
        ]),
        rows: [
          [cell("ID"), cell("Name"), cell("Epic")],
          [cell("A-1"), cell("One"), cell("Fares", "a note")],
          [cell("A-2"), cell("Two"), null],
        ],
        merges: [{ startRow: 1, endRow: 3, startColumn: 2, endColumn: 3 }],
      },
      mapping,
    ),
  );
  assert.deepEqual(
    rows.map((r) => r.cells[2]),
    [
      { header: "Epic", value: "Fares", note: "a note" },
      { header: "Epic", value: "Fares", note: null },
    ],
  );
});

test("rows hidden by hand are read when the mapping says; a hidden column only when mapped", () => {
  const hidden = grid(
    [
      ["ID", "Name", "Secret"],
      ["A-1", "One", "s1"],
      ["A-2", "Two", "s2"],
    ],
    { hiddenRows: new Set([2]), hiddenColumns: new Set([2]) },
  );
  const skipped = tableOf(hidden, mapping);
  assert.ok(!("stopped" in skipped));
  assert.equal(skipped.hidden, 1);
  assert.deepEqual(
    skipped.rows.map((r) => r.cells.map((c) => c.header)),
    [["ID", "Name"]],
  );
  assert.equal(rowsOf(tableOf(hidden, { ...mapping, hidden: true })).length, 2);
  assert.deepEqual(
    rowsOf(tableOf(hidden, { ...mapping, assignee: "Secret" }))[0]?.fields.assignee,
    "s1",
  );
});

test("statuses map to states by the mapping's values, ignoring case; estimates read numbers as text", () => {
  const rows = rowsOf(
    tableOf(
      grid([
        ["ID", "Name", "Status", "Points", "Link"],
        ["A-1", "One", "in progress", " 3 ", "https://example.com/a"],
        ["A-2", "Two", "Red", "lots", "not a link"],
      ]),
      {
        ...mapping,
        status: "Status",
        states: { todo: ["To do"], "in-progress": ["In progress"], done: ["Done"] },
        estimate: "Points",
        link: "Link",
      },
    ),
  );
  assert.deepEqual(
    rows.map((r) => r.fields),
    [
      {
        title: "One",
        status: "in progress",
        state: "in-progress",
        estimate: 3,
        link: "https://example.com/a",
      },
      { title: "Two", status: "Red", state: null, estimate: null, link: null },
    ],
  );
});

test("the cap reads only the first rows and says more followed", () => {
  const table = tableOf(
    grid([
      ["ID", "Name"],
      ["A-1", "One"],
      ["A-2", "Two"],
    ]),
    mapping,
    1,
  );
  assert.ok(!("stopped" in table));
  assert.equal(table.rows.length, 1);
  assert.equal(table.capped, true);
});

test("a mapping holds each spreadsheet, tab and column once, and states only with a status", () => {
  const pick = (tabs: unknown[]) => sheetsPicks({ spreadsheets: [{ id: "1Abcdefghijk", tabs }] });
  assert.ok(pick([mapping]).ok);
  assert.ok(!pick([mapping, mapping]).ok);
  assert.ok(!pick([{ ...mapping, status: "ID" }]).ok);
  assert.ok(!pick([{ ...mapping, states: { todo: [], "in-progress": [], done: [] } }]).ok);
  assert.ok(!pick([{ ...mapping, key: " " }]).ok);
  assert.notEqual(
    mappingPrint({ id: "x", tabs: [mapping] }),
    mappingPrint({ id: "x", tabs: [{ ...mapping, hidden: true }] }),
  );
});

test("a unique name may be both a tab's key and its title", () => {
  const named = { ...mapping, key: "Name" };
  assert.ok(sheetsPicks({ spreadsheets: [{ id: "1Abcdefghijk", tabs: [named] }] }).ok);
  const rows = rowsOf(tableOf(grid([["Name"], ["Rebooking"]]), named));
  assert.deepEqual(
    rows.map((r) => [r.key, r.fields.title]),
    [["Rebooking", "Rebooking"]],
  );
});
