import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { fixtureProblem, gridOf, loadFixture } from "./fixture.ts";

test("the shipped fixture is one: a backlog with a header row and 20 rows, and a second tab", () => {
  const fixture = loadFixture(fileURLToPath(new URL("../fixture/backlog.json", import.meta.url)));
  const [backlog] = fixture.spreadsheets;
  assert.equal(backlog?.tabs.length, 2);
  assert.equal(backlog?.tabs[0]?.frozenRows, 1);
  assert.equal(backlog?.tabs[0]?.rows.length, 21);
});

test("what's wrong with a fixture is said where it is", () => {
  const tab = { sheetId: 0, title: "A", rows: [] };
  const sheet = { id: "s1", name: "S", modifiedTime: "2026-11-01T00:00:00Z", tabs: [tab] };
  assert.equal(fixtureProblem({ spreadsheets: [sheet] }), null);
  assert.equal(fixtureProblem([]), "a fixture is an object with a `spreadsheets` list");
  assert.equal(
    fixtureProblem({ spreadsheets: [sheet, sheet] }),
    "spreadsheets[1].id is another spreadsheet's too",
  );
  assert.equal(
    fixtureProblem({ spreadsheets: [{ ...sheet, tabs: [tab, tab] }] }),
    "spreadsheets[0].tabs[1].sheetId is a whole number of its own",
  );
  assert.equal(
    fixtureProblem({ spreadsheets: [{ ...sheet, tabs: [{ ...tab, rows: [[1]] }] }] }),
    "spreadsheets[0].tabs[0].rows isn't rows of text",
  );
  assert.equal(
    fixtureProblem({ spreadsheets: [{ ...sheet, modifiedTime: "soon" }] }),
    "spreadsheets[0].modifiedTime isn't an RFC 3339 time",
  );
});

test("a tab's grid is at least 1,000 by 26, and grows to fit", () => {
  assert.deepEqual(gridOf({ sheetId: 0, title: "A", rows: [] }), { rows: 1000, columns: 26 });
  assert.deepEqual(
    gridOf({
      sheetId: 0,
      title: "A",
      rowCount: 2,
      columnCount: 2,
      rows: [["a", "b", "c"], [], []],
    }),
    { rows: 3, columns: 3 },
  );
});
