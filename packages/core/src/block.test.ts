import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Answered,
  type BlockSpec,
  blockSpec,
  buildBlock,
  ignoredKeys,
  maxBars,
  maxRows,
  readKey,
  searchFields,
  type ResultFields,
  specProblems,
} from "./block.ts";

const spec = (input: unknown): BlockSpec => {
  const checked = blockSpec(input);
  if (!checked.ok) throw new Error(JSON.stringify(checked.issues));
  return checked.value;
};

const overview: ResultFields = {
  source: "the overview",
  lists: {
    "changed.workstreams": { name: "Workstream", moved: "Items moved since you looked" },
    "workstreams.1.movedItems": { id: "Item" },
  },
};
const stories: ResultFields = {
  source: "a source, read live",
  lists: { "": { key: "Key", points: "Points", done: "Done", x: "X", id: "Item" } },
};
const answered = (value: unknown, fields: ResultFields | null, outside = false): Answered => ({
  value,
  fields,
  outside,
});

test("bars show the largest ten, ranked, under the read's labels, and how many more", () => {
  const rows = Array.from({ length: 13 }, (_, i) => ({ name: `w${i}`, moved: i }));
  const built = buildBlock(
    spec({
      read: "window.overview",
      from: "changed.workstreams",
      form: "bars",
      label: "name",
      value: "moved",
    }),
    answered({ changed: { workstreams: rows } }, overview, true),
  );
  assert.ok(built.ok && built.block.form === "bars");
  assert.equal(built.block.bars.length, maxBars);
  assert.deepEqual(built.block.bars[0], { label: "w12", value: 12 });
  assert.equal(built.block.more, 3);
  assert.equal(built.block.outside, true);
  assert.equal(
    built.block.caption,
    "Computed by Oriel from the overview: Items moved since you looked by Workstream, highest first",
  );
});

test("a table keeps its columns' values as they are, under their labels, up to its row cap", () => {
  const rows = Array.from({ length: maxRows + 2 }, (_, i) => ({
    key: `A-${i}`,
    points: i,
    done: i % 2 === 0,
    x: { y: 1 },
  }));
  const built = buildBlock(
    spec({ read: "jira.listStories", form: "table", columns: ["key", "points", "done"] }),
    answered(rows, stories),
  );
  assert.ok(built.ok && built.block.form === "table");
  assert.deepEqual(built.block.columns, ["Key", "Points", "Done"]);
  assert.deepEqual(built.block.rows[1], ["A-1", 1, false]);
  assert.equal(built.block.more, 2);
  const nested = buildBlock(
    spec({ read: "jira.listStories", form: "table", columns: ["x"] }),
    answered(rows, stories),
  );
  assert.deepEqual(nested, {
    ok: false,
    why: 'row 0 of its result has no text, number or yes/no in "x"',
  });
});

test("only declared lists and fields show, and a read that declares none makes no block", () => {
  const value = { changed: { workstreams: [{ name: "a", moved: 1, secret: 2 }] } };
  const undeclared = buildBlock(
    spec({
      read: "window.overview",
      from: "changed.workstreams",
      form: "bars",
      label: "name",
      value: "secret",
    }),
    answered(value, overview),
  );
  assert.deepEqual(undeclared, {
    ok: false,
    why: '"secret" isn\'t a field window.overview declares in its field "changed.workstreams"; it declares "name", "moved"',
  });
  const list = buildBlock(
    spec({ read: "window.overview", from: "changed", form: "rows" }),
    answered(value, overview),
  );
  assert.equal(list.ok, false);
  assert.match(list.ok ? "" : list.why, /declares no list a block can show in its field "changed"/);
  // Without `from`, it says which key takes the list, and each list's name.
  const unnamed = buildBlock(
    spec({ read: "window.overview", form: "bars", label: "name", value: "moved" }),
    answered(value, overview),
  );
  assert.match(
    unnamed.ok ? "" : unnamed.why,
    /in its result; set `from` to one of its lists, "changed\.workstreams"/,
  );
  // A read whose result is its one list says to leave `from` out.
  const extra = buildBlock(
    spec({ read: "search", from: "hits", form: "rows" }),
    answered([], searchFields),
  );
  assert.deepEqual(extra, {
    ok: false,
    why: 'search declares no list a block can show in its field "hits"; leave `from` out for its result',
  });
  const none = buildBlock(spec({ read: "items.read", form: "rows" }), answered([], null));
  assert.deepEqual(none, { ok: false, why: "items.read declares nothing a block can show" });
});

test("rows take the items' IDs in id, through objects' fields and lists' places", () => {
  const placed = buildBlock(
    spec({ read: "window.overview", from: "workstreams.1.movedItems", form: "rows" }),
    answered(
      { workstreams: [{ movedItems: [] }, { movedItems: [{ id: "jira:SYN-3" }] }] },
      overview,
    ),
  );
  assert.ok(placed.ok && placed.block.form === "rows" && placed.block.items[0] === "jira:SYN-3");
  const bad = buildBlock(
    spec({ read: "jira.listStories", form: "rows" }),
    answered([{ id: "nope" }], stories),
  );
  assert.deepEqual(bad, { ok: false, why: 'row 0 of its result has no item\'s ID in "id"' });
});

test("a read with no list where the spec says, or an empty one, makes no block", () => {
  assert.deepEqual(
    buildBlock(spec({ read: "jira.listStories", form: "rows" }), answered({ a: 1 }, stories)),
    {
      ok: false,
      why: "jira.listStories returned no list in its result",
    },
  );
  assert.deepEqual(
    buildBlock(spec({ read: "jira.listStories", form: "rows" }), answered([], stories)),
    {
      ok: false,
      why: "its result is empty",
    },
  );
});

test("a bar needs a number, never a numeric string", () => {
  const built = buildBlock(
    spec({ read: "jira.listStories", form: "bars", label: "key", value: "points" }),
    answered([{ key: "x", points: "5" }], stories),
  );
  assert.deepEqual(built, { ok: false, why: 'row 0 of its result has no number in "points"' });
});

test("the spec refuses more than five columns, and an unknown form", () => {
  assert.equal(
    blockSpec({ read: "r", form: "table", columns: ["a", "b", "c", "d", "e", "f"] }).ok,
    false,
  );
  assert.equal(blockSpec({ read: "r", form: "pie" }).ok, false);
});

test("a read's key ignores missing trailing arguments, as the guest drops them", () => {
  assert.equal(readKey("search", ["x", undefined]), readKey("search", ["x"]));
  assert.equal(readKey("window.overview"), "window.overview()");
});

test("a row lacking a declared field, as an item gone from its source, is a blank cell or no bar", () => {
  const rows = [
    { key: "A-1", points: 3 },
    { id: "jira:SYN-9", gone: true },
  ];
  const table = buildBlock(
    spec({ read: "jira.listStories", form: "table", columns: ["key", "points"] }),
    answered(rows, stories),
  );
  assert.ok(table.ok && table.block.form === "table");
  assert.deepEqual(table.block.rows, [
    ["A-1", 3],
    [null, null],
  ]);
  const bars = buildBlock(
    spec({ read: "jira.listStories", form: "bars", label: "key", value: "points" }),
    answered(rows, stories),
  );
  assert.ok(bars.ok && bars.block.form === "bars");
  assert.deepEqual(bars.block.bars, [{ label: "A-1", value: 3 }]);
});

test("bars sum the rows that share a label, through a nested field, and say so", () => {
  const listed: ResultFields = {
    source: "this workstream's stories, read live",
    lists: { "": { id: "Item", "assignee.name": "Assignee", points: "Story points" } },
  };
  const rows = [
    { id: "jira:SYN-26", assignee: { name: "Amara" }, points: 5 },
    { id: "jira:SYN-47", assignee: { name: "Amara" }, points: 3 },
    { id: "jira:SYN-84", assignee: { name: "Dara" }, points: 5 },
    // No estimate adds nothing; no one assigned is a blank, as in a table.
    { id: "jira:SYN-85", assignee: { name: "Amara" }, points: null },
    { id: "jira:SYN-61", assignee: null, points: 3 },
    { id: "jira:SYN-9", gone: true },
  ];
  const built = buildBlock(
    spec({ read: "jira.listStories", form: "bars", label: "assignee.name", value: "points" }),
    answered(rows, listed),
  );
  assert.ok(built.ok && built.block.form === "bars");
  assert.deepEqual(built.block.bars, [
    { label: "Amara", value: 8 },
    { label: "Dara", value: 5 },
    { label: "—", value: 3 },
  ]);
  assert.equal(
    built.block.caption,
    "Computed by Oriel from this workstream's stories, read live: Story points by Assignee, summed, highest first",
  );
  const table = buildBlock(
    spec({ read: "jira.listStories", form: "table", columns: ["id", "assignee.name"] }),
    answered(rows.slice(4, 5), listed),
  );
  assert.ok(table.ok && table.block.form === "table");
  assert.deepEqual(table.block.rows, [["jira:SYN-61", null]]);
});

test("a field the read doesn't declare, holding exactly one it does, is that one", () => {
  const stories: ResultFields = {
    source: "stories",
    lists: { "": { id: "Item", "assignee.name": "Assignee", points: "Story points" } },
  };
  const rows = [
    { id: "jira:SYN-1", assignee: { name: "Amara" }, points: 3 },
    { id: "jira:SYN-2", assignee: { name: "Amara" }, points: 2 },
  ];
  const built = buildBlock(
    spec({ read: "jira.listStories", form: "bars", label: "assignee", value: "points" }),
    answered(rows, stories),
  );
  assert.ok(built.ok && built.block.form === "bars");
  assert.deepEqual(built.block.bars, [{ label: "Amara", value: 5 }]);
  assert.match(built.block.caption, /Story points by Assignee, summed/);
  // Under two declared fields, it is still refused, naming them.
  const two: ResultFields = {
    source: "stories",
    lists: { "": { "assignee.name": "Assignee", "assignee.email": "Email", points: "Points" } },
  };
  const refused = buildBlock(
    spec({ read: "jira.listStories", form: "table", columns: ["assignee"] }),
    answered(rows, two),
  );
  assert.match(
    refused.ok ? "" : refused.why,
    /"assignee" isn't a field jira\.listStories declares/,
  );
});

test("a spec's ignored keys are those its form doesn't take, or no form takes when it names none", () => {
  assert.deepEqual(
    ignoredKeys({ read: "history", form: "bars", label: "id", filter: {}, title: "x", rows: "y" }),
    ["filter", "title", "rows"],
  );
  assert.deepEqual(ignoredKeys({ read: "history", form: "pivot", rows: "assignee" }), []);
  assert.deepEqual(ignoredKeys({ read: "history", form: "chart", rows: "a", sort: "desc" }), [
    "sort",
  ]);
  assert.deepEqual(ignoredKeys("bars"), []);
});

test("a refused spec is told what its form lacks and what it got wrong, by key", () => {
  assert.equal(
    specProblems({ read: "history", form: "bars", title: "x" }),
    "a bars block needs `label` and `value`",
  );
  assert.equal(
    specProblems({ read: "w", form: "table", columns: [] }),
    "`columns` takes 1 to 5 columns",
  );
  assert.equal(
    specProblems({ read: "w", form: "series", at: "doneAt", every: "year" }),
    `\`every\` takes "day" or "week"`,
  );
  assert.match(
    specProblems({ read: "w", form: "chart" }),
    /^`form` is one of "bars", "table", "rows",/,
  );
  assert.equal(specProblems([]), "show() takes one object");
});
