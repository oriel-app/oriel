import assert from "node:assert/strict";
import { test } from "node:test";
import { reportLines } from "./report.ts";
import type { SheetsReport, TabReport } from "./source.ts";

const tab = (over: Partial<TabReport>): TabReport => ({
  sheetId: 0,
  title: "Tracker",
  duplicates: [],
  keyless: [],
  hidden: 0,
  capped: false,
  ...over,
});
const report = (tabs: TabReport[]): SheetsReport => ({
  spreadsheets: [{ id: "s", title: "Delivery tracker", tabs }],
  unread: { spreadsheets: 0, tabs: 0 },
});

test("rows left out are named by the Row ID the mapping calls them", () => {
  assert.deepEqual(reportLines(report([tab({ duplicates: [14, 22] })])), [
    "Delivery tracker, Tracker: rows 14 and 22 share a Row ID, so none of them is an item yet.",
  ]);
  assert.deepEqual(reportLines(report([tab({ keyless: [3, 7] })])), [
    "Delivery tracker, Tracker: rows 3 and 7 have no Row ID, so they aren't items yet.",
  ]);
});

test("one row without a Row ID reads as one", () => {
  assert.deepEqual(reportLines(report([tab({ keyless: [12] })])), [
    "Delivery tracker, Tracker: row 12 has no Row ID, so it isn't an item yet.",
  ]);
});
