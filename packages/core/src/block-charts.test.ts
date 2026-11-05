import assert from "node:assert/strict";
import { test } from "node:test";
import { type BlockSpec, blockSpec, buildBlock, builtBlock, itemLabels } from "./block.ts";
import type { ChangeLogEntry } from "./change-log.ts";
import { historyFields, historyOf } from "./history.ts";
import type { Instant, ItemId } from "./ids.ts";
import type { IndexRecord, State } from "./source.ts";

const at = (iso: string) => `${iso}T09:00:00.000Z` as Instant;
const asOf = at("2026-11-02");

const record = (
  key: string,
  state: State,
  extra: Partial<IndexRecord["facets"]> = {},
  updated = "2026-08-01",
): IndexRecord => ({
  id: `jira:${key}` as ItemId,
  stableId: key,
  title: `Story ${key}`,
  location: "https://example.test",
  updatedAt: at(updated),
  facets: {
    state,
    kind: "story",
    people: [{ role: "assignee", id: "a", name: key < "SYN-5" ? "Amara" : "Bastian" }],
    container: { id: "jira:SYN-100" as ItemId, stableId: "SYN-100" },
    estimate: 2,
    ...extra,
  },
  attrs: {},
});

let seq = 0;
const move = (key: string, day: string, before: State, after: State): ChangeLogEntry => ({
  seq: ++seq,
  source: "jira",
  stableId: key,
  version: seq,
  at: at(day),
  facets: { state: { before, after } },
  gone: false,
});

const stories = [
  record("SYN-1", "done"),
  record("SYN-2", "done"),
  record("SYN-3", "in-progress"),
  record("SYN-4", "todo"),
  record("SYN-6", "done", {}, "2026-10-20"),
];
const log = [
  // Oriel's log starts on Sep 7, with something else.
  { ...move("SYN-9", "2026-09-07", "todo", "in-progress") },
  move("SYN-1", "2026-09-15", "todo", "in-progress"),
  move("SYN-1", "2026-09-29", "in-progress", "done"),
  move("SYN-2", "2026-10-13", "in-progress", "done"),
  move("SYN-3", "2026-10-21", "todo", "in-progress"),
];
const history = historyOf(stories, log, asOf);
const answered = { value: history, outside: true, fields: historyFields };
const spec = (input: unknown): BlockSpec => {
  const checked = blockSpec({ read: "history", from: "items", ...(input as object) });
  if (!checked.ok) throw new Error(JSON.stringify(checked.issues));
  return checked.value;
};

test("history dates each item from the change log, and what the log never saw by its horizon", () => {
  assert.equal(history.since, at("2026-09-07"));
  const by = new Map(history.items.map((item) => [item.id, item]));
  assert.equal(by.get("jira:SYN-1")?.startedAt, at("2026-09-15"));
  assert.equal(by.get("jira:SYN-1")?.doneAt, at("2026-09-29"));
  // Already in progress when the log starts: started by then.
  assert.equal(by.get("jira:SYN-2")?.startedAt, history.since);
  assert.equal(by.get("jira:SYN-3")?.daysInState, 12);
  assert.equal(by.get("jira:SYN-3")?.inStateBefore, false);
  // Never seen moving: in its state at least since the log starts.
  assert.equal(by.get("jira:SYN-4")?.inStateBefore, true);
  assert.equal(by.get("jira:SYN-4")?.startedAt, null);
  // Never seen moving, and touched since the log starts: done by that touch,
  // since it may have joined the index after the log started.
  assert.equal(by.get("jira:SYN-6")?.doneAt, at("2026-10-20"));
  assert.equal(by.get("jira:SYN-1")?.assignee, "Amara");
  // IDs and facets, never content: its epic is the epic's ID, and no title.
  assert.equal(by.get("jira:SYN-1")?.epic, "jira:SYN-100");
  assert.ok(!JSON.stringify(history).includes("Story SYN-1"));
});

test("an item seen first moving from a started state started by the log's start, whatever touched it after", () => {
  const touched = record("SYN-7", "done", {}, "2026-10-30");
  const [item] = historyOf(
    [touched],
    [log[0] as ChangeLogEntry, move("SYN-7", "2026-10-20", "in-progress", "done")],
    asOf,
  ).items;
  assert.equal(item?.startedAt, at("2026-09-07"));
  assert.equal(item?.doneAt, at("2026-10-20"));
});

test("a pivot groups by a field it was asked for, however many values it has", () => {
  const many = historyOf(
    Array.from({ length: 60 }, (_, i) =>
      record(`SYN-${200 + i}`, "todo", {
        people: [{ role: "assignee", id: `p${i}`, name: `Person ${i}` }],
      }),
    ),
    log,
    asOf,
  );
  const built = buildBlock(spec({ form: "pivot", rows: "assignee" }), { ...answered, value: many });
  assert.ok(built.ok && built.block.form === "pivot");
  assert.equal(built.block.tables["assignee|"]?.rows.at(-1), "Other");
});

test("a block of history() isn't the escape hatch: it holds no content", () => {
  const built = buildBlock(spec({ form: "spread", value: "daysInState" }), answered);
  assert.ok(built.ok);
  assert.equal(built.block.outside, false);
  // A read that holds content, from outside the region, still is.
  const { contentFree: _free, ...withContent } = historyFields;
  const outside = buildBlock(spec({ form: "spread", value: "daysInState" }), {
    ...answered,
    fields: withContent,
  });
  assert.ok(outside.ok && outside.block.outside);
  // Rows of it show each item's title, so they are still marked outside.
  const rows = buildBlock(spec({ form: "rows" }), answered);
  assert.ok(rows.ok && rows.block.outside);
});

test("a running series of done dates from history: its caption says the method and what it can't know", () => {
  const built = buildBlock(
    spec({ form: "series", at: "doneAt", running: true, fit: true }),
    answered,
  );
  assert.ok(built.ok && built.block.form === "series");
  assert.equal(built.block.series.total, 5);
  assert.match(
    built.block.caption,
    /^Computed by Oriel from the index and its change log: Done, counted by week, running, since Sep 7/,
  );
  // Eight whole weeks, but only three done in them: no line.
  // The week the log starts in is partial, so seven whole weeks, but only
  // three done in them: no line.
  assert.match(
    built.block.caption,
    /No line: too little happened to fit a line: 3 in 7 whole weeks/,
  );
  // It reads back as it was stored.
  assert.deepEqual(builtBlock(JSON.parse(JSON.stringify(built.block))), {
    ok: true,
    value: built.block,
  });
});

test("a timeline draws each started item to its end or to today, from the left edge when it started earlier", () => {
  const built = buildBlock(spec({ form: "timeline", start: "startedAt", end: "doneAt" }), answered);
  assert.ok(built.ok && built.block.form === "timeline");
  assert.equal(built.block.lanes.length, 4);
  // With no label, each lane is its item, by ID, which the window names.
  assert.ok(built.block.lanes.every((lane) => lane.label === lane.id));
  assert.equal(built.block.undated, 1);
  const open = built.block.lanes.find((lane) => lane.id === "jira:SYN-3");
  assert.equal(open?.end, null);
  assert.ok(built.block.lanes.some((lane) => lane.earlier));
  assert.match(built.block.caption, /a bar from the left edge started by Sep 7/i);
  const grouped = buildBlock(
    spec({ form: "timeline", start: "startedAt", end: "doneAt", by: "epic" }),
    answered,
  );
  assert.ok(grouped.ok && grouped.block.form === "timeline");
  assert.deepEqual(
    grouped.block.lanes.map((lane) => [lane.label, lane.count, lane.ended, lane.end]),
    [["jira:SYN-100", 5, 3, null]],
  );
  // A group of rows none of which has started has no bar; one with a row
  // still to start is still going, and counts it.
  const unstarted = historyOf(
    [record("SYN-1", "done"), record("SYN-4", "todo")],
    log.filter((entry) => entry.stableId === "SYN-1"),
    asOf,
  );
  const going = buildBlock(
    spec({ form: "timeline", start: "startedAt", end: "doneAt", by: "epic" }),
    { ...answered, value: unstarted },
  );
  assert.ok(going.ok && going.block.form === "timeline");
  assert.deepEqual(
    going.block.lanes.map((lane) => [lane.count, lane.ended, lane.end]),
    [[2, 1, null]],
  );
  // A read whose rows aren't items needs a label for each bar.
  const plain = {
    value: { asOf, since: at("2026-09-07"), rows: [{ name: "a", from: at("2026-09-10") }] },
    outside: false,
    fields: {
      source: "x",
      time: { asOf: "asOf", since: "since" },
      lists: { rows: { name: "Name", from: "From" } },
    },
  };
  const unlabelled = buildBlock(
    { read: "x", from: "rows", form: "timeline", start: "from", end: "from" } as BlockSpec,
    plain,
  );
  assert.deepEqual(unlabelled, {
    ok: false,
    why: 'its field "rows" holds no items, so name each bar\'s `label`',
  });
});

test("a spread of days in state says its bounds are bounds", () => {
  const built = buildBlock(spec({ form: "spread", value: "daysInState" }), answered);
  assert.ok(built.ok && built.block.form === "spread");
  assert.equal(built.block.spread.n, 5);
  assert.match(built.block.caption, /median at least/i);
  assert.match(built.block.caption, /began before the change log starts/i);
  assert.match(built.block.caption, /only 5, so the percentiles say little/i);
});

test("a pivot holds every grouping of its fields, so the window regroups it with no model", () => {
  const built = buildBlock(spec({ form: "pivot", rows: "assignee", columns: "state" }), answered);
  assert.ok(built.ok && built.block.form === "pivot");
  const dims = built.block.dims.map((d) => d.field);
  assert.deepEqual(dims.slice(0, 2), ["assignee", "state"]);
  for (const down of dims)
    for (const across of ["", ...dims.filter((d) => d !== down)])
      assert.ok(built.block.tables[`${down}|${across}`], `${down}|${across}`);
  const table = built.block.tables["assignee|state"];
  const amara = table?.rows.indexOf("Amara") ?? -1;
  const done = table?.columns.indexOf("Done") ?? -1;
  assert.deepEqual(table?.cells[amara]?.[done], [2, 4]);
  assert.deepEqual(builtBlock(JSON.parse(JSON.stringify(built.block))), {
    ok: true,
    value: built.block,
  });
});

test("a pivot built for a pin is only the grouping it was pinned with", () => {
  const regrouped = spec({ form: "pivot", rows: "epic", columns: "state", value: "estimate" });
  const pinned = buildBlock(regrouped, answered, { pinned: true });
  assert.ok(pinned.ok && pinned.block.form === "pivot");
  assert.deepEqual(Object.keys(pinned.block.tables), ["epic|state"]);
  assert.deepEqual(pinned.block.initial, { down: "epic", across: "state", measure: 1 });
  // The same grid as the window's, where every grouping is built.
  const whole = buildBlock(regrouped, answered);
  assert.ok(whole.ok && whole.block.form === "pivot");
  assert.deepEqual(pinned.block.tables["epic|state"], whole.block.tables["epic|state"]);
  assert.match(
    pinned.block.caption,
    /^Computed by Oriel from .*: Sum of Estimate by Epic and State, of 5 rows$/,
  );
  assert.match(whole.block.caption, /of 5 rows; it can be regrouped in the window/);
});

test("a chart over time from a read with no dates, or naming a field it lacks, is refused", () => {
  const plain = {
    value: [{ name: "a", n: 1 }],
    outside: false,
    fields: { source: "x", lists: { "": { name: "Name", n: "N" } } },
  };
  const refused = buildBlock({ read: "x", form: "series", at: "name" } as BlockSpec, plain);
  assert.deepEqual(refused, { ok: false, why: "its result has no dates to draw over time" });
  const unknown = buildBlock(spec({ form: "spread", value: "cycle" }), answered);
  assert.ok(!unknown.ok && /"cycle" isn't a field history declares/.test(unknown.why));
  const wrong = buildBlock(spec({ form: "pivot", rows: "estimate" }), answered);
  assert.ok(!wrong.ok && /isn't a field to group by/.test(wrong.why));
});

test("bars of a number the read says may be a lower bound mark each such bar, and say so", () => {
  const built = buildBlock(spec({ form: "bars", label: "id", value: "daysInState" }), answered);
  assert.ok(built.ok && built.block.form === "bars");
  const bound = built.block.bars.find((bar) => bar.label === "jira:SYN-4");
  assert.equal(bound?.atLeast, true);
  assert.equal(built.block.bars.find((bar) => bar.label === "jira:SYN-3")?.atLeast, undefined);
  assert.match(built.block.caption, /≥ marks a value that is only a lower bound/);
});

test("a table marks each cell of a number that is only a lower bound, by the same rule as bars, and says so", () => {
  const columns = ["id", "epic", "daysInState"];
  const built = buildBlock(spec({ form: "table", columns }), answered);
  assert.ok(built.ok && built.block.form === "table");
  // SYN-4 and SYN-6 were never seen moving: in their state since at least
  // when the log starts.
  assert.deepEqual(built.block.atLeast, [
    { row: 3, column: 2 },
    { row: 4, column: 2 },
  ]);
  assert.match(
    built.block.caption,
    /Days in its state\. ≥ marks a value that is only a lower bound/,
  );
  assert.deepEqual(builtBlock(JSON.parse(JSON.stringify(built.block))), {
    ok: true,
    value: built.block,
  });
  // A table showing no bounded number has no marks, and no note.
  const plain = buildBlock(spec({ form: "table", columns: ["id", "estimate"] }), answered);
  assert.ok(plain.ok && plain.block.form === "table");
  assert.equal(plain.block.atLeast, undefined);
  assert.doesNotMatch(plain.block.caption, /≥/);
});

test("a series or a pivot never sums a number that is only a lower bound, which neither could mark", () => {
  const series = buildBlock(
    spec({ form: "series", at: "stateSince", value: "daysInState" }),
    answered,
  );
  assert.ok(!series.ok && /only a lower bound in some rows/.test(series.why));
  // Even from a read that says every number adds up.
  const { sums: _sums, ...unsummed } = historyFields;
  const everything = { ...answered, fields: unsummed };
  const pivot = buildBlock(spec({ form: "pivot", rows: "state" }), everything);
  assert.ok(pivot.ok && pivot.block.form === "pivot");
  assert.deepEqual(
    pivot.block.measures.map((m) => m.field),
    ["estimate", "daysSinceUpdate"],
  );
  // Rows that are all exact sum as any number does.
  const exact = buildBlock(
    spec({ form: "series", at: "stateSince", value: "daysInState", where: { id: "jira:SYN-3" } }),
    answered,
  );
  assert.ok(exact.ok, exact.ok ? "" : exact.why);
  const summed = buildBlock(
    spec({ form: "pivot", rows: "state", value: "daysInState" }),
    everything,
  );
  assert.ok(!summed.ok && /isn't a number to sum/.test(summed.why));
});

test("every form's labels that are items are listed in one place, for the window to name", () => {
  const labels = (input: unknown) => {
    const built = buildBlock(spec(input), answered);
    assert.ok(built.ok);
    return itemLabels(built.block);
  };
  assert.deepEqual(labels({ form: "bars", label: "epic", value: "estimate" }), ["jira:SYN-100"]);
  // A table's Item and Epic, never its assignee's name.
  assert.deepEqual(labels({ form: "table", columns: ["id", "epic", "assignee"] }), [
    "jira:SYN-1",
    "jira:SYN-100",
    "jira:SYN-2",
    "jira:SYN-3",
    "jira:SYN-4",
    "jira:SYN-6",
  ]);
  assert.deepEqual(labels({ form: "timeline", start: "startedAt", end: "doneAt" }).toSorted(), [
    "jira:SYN-1",
    "jira:SYN-2",
    "jira:SYN-3",
    "jira:SYN-6",
  ]);
  assert.deepEqual(labels({ form: "pivot", rows: "epic", columns: "assignee" }), ["jira:SYN-100"]);
  assert.deepEqual(labels({ form: "spread", value: "daysInState" }), []);
  assert.deepEqual(labels({ form: "series", at: "doneAt" }), []);
});
