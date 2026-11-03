import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Answered,
  type BlockSpec,
  blockSpec,
  buildBlock,
  maxBars,
  maxRows,
  readKey,
  type ResultFields,
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
