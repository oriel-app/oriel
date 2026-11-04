import assert from "node:assert/strict";
import { test } from "node:test";
import { columnIndex, columnLetters, parseBounds, parseCell, parseRange, quoteTab } from "./a1.ts";

test("columns by letter, both ways", () => {
  for (const [letters, index] of [
    ["A", 0],
    ["Z", 25],
    ["AA", 26],
    ["AZ", 51],
    ["ZZ", 701],
    ["AAA", 702],
  ] as const) {
    assert.equal(columnIndex(letters), index);
    assert.equal(columnLetters(index), letters);
  }
  assert.equal(columnIndex("a"), null);
  assert.equal(columnIndex(""), null);
});

test("bounds are zero-based and half-open, and a missing end is unbounded", () => {
  assert.deepEqual(parseBounds("A3:B4"), { startRow: 2, endRow: 4, startColumn: 0, endColumn: 2 });
  assert.deepEqual(parseBounds("C3"), { startRow: 2, endRow: 3, startColumn: 2, endColumn: 3 });
  assert.deepEqual(parseBounds("B:B"), { startColumn: 1, endColumn: 2 });
  assert.deepEqual(parseBounds("5:9"), { startRow: 4, endRow: 9 });
  assert.deepEqual(parseBounds("A5:A"), { startRow: 4, startColumn: 0, endColumn: 1 });
  assert.deepEqual(parseCell("i12"), { row: 11, column: 8 });
  for (const bad of ["", "B", "7", "5:A", "B4:A1", "A0", "A1:B2:C3", "A1:"])
    assert.equal(parseBounds(bad), null, bad);
});

test("a range's tab, quoted or not, or the first tab, or all of one", () => {
  assert.deepEqual(parseRange("Tracker!A1:I12"), {
    tab: "Tracker",
    bounds: { startRow: 0, endRow: 12, startColumn: 0, endColumn: 9 },
  });
  assert.deepEqual(parseRange("A1:B2")?.tab, null);
  assert.deepEqual(parseRange("Tracker"), { tab: "Tracker", bounds: null });
  const awkward = "Ferrowick's tab! 🌐";
  assert.equal(quoteTab(awkward), "'Ferrowick''s tab! 🌐'");
  assert.deepEqual(parseRange(`${quoteTab(awkward)}!B2`)?.tab, awkward);
  assert.deepEqual(parseRange(quoteTab(awkward)), { tab: awkward, bounds: null });
  for (const bad of ["'unclosed!A1", "''!A1", "'Tab'A1", "Tab!Q", "!A1"])
    assert.equal(parseRange(bad), null, bad);
});
