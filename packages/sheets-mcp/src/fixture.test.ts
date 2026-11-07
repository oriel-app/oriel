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
  assert.equal(Object.keys(backlog?.tabs[0]?.notes ?? {}).length, 1);
  assert.equal(backlog?.comments?.length, 2);
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
  const noted = (extra: Record<string, unknown>) =>
    fixtureProblem({ spreadsheets: [{ ...sheet, tabs: [{ ...tab, ...extra }] }] });
  assert.equal(noted({ notes: { C3: "x" }, hiddenRows: [2], hiddenColumns: ["B"] }), null);
  assert.equal(
    noted({ notes: { "3C": "x" } }),
    "spreadsheets[0].tabs[0].notes isn't text by cell, such as `C3`",
  );
  assert.equal(noted({ hiddenRows: [0] }), "spreadsheets[0].tabs[0].hiddenRows isn't row numbers");
  assert.equal(
    noted({ hiddenColumns: ["b"] }),
    "spreadsheets[0].tabs[0].hiddenColumns isn't column letters",
  );
  const said = { author: "A", content: "x", createdTime: "2026-11-01T00:00:00Z" };
  assert.equal(
    fixtureProblem({ spreadsheets: [{ ...sheet, comments: [{ ...said, replies: [said] }] }] }),
    null,
  );
  assert.equal(
    fixtureProblem({ spreadsheets: [{ ...sheet, comments: [{ ...said, resolved: "yes" }] }] }),
    "spreadsheets[0].comments[0].resolved isn't true or false",
  );
  assert.equal(
    fixtureProblem({
      spreadsheets: [{ ...sheet, comments: [{ ...said, replies: [{ author: "B" }] }] }],
    }),
    "spreadsheets[0].comments[0].replies[0].content isn't text",
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
