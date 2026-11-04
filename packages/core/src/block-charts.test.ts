import assert from "node:assert/strict";
import { test } from "node:test";
import { type BlockSpec, blockSpec, buildBlock, builtBlock } from "./block.ts";
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

const epic: IndexRecord = {
  ...record("SYN-100", "in-progress"),
  title: "Payments",
  facets: { state: "in-progress", kind: "epic" },
};
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
const history = historyOf(stories, log, asOf, [epic, ...stories]);
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
  assert.equal(by.get("jira:SYN-1")?.epic, "Payments");
  assert.equal(by.get("jira:SYN-1")?.assignee, "Amara");
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
  assert.match(built.block.caption, /No line: too little happened to fit a line: 3 since Sep 7/);
  // It reads back as it was stored.
  assert.deepEqual(builtBlock(JSON.parse(JSON.stringify(built.block))), {
    ok: true,
    value: built.block,
  });
});

test("a timeline draws each started item to its end or to today, from the left edge when it started earlier", () => {
  const built = buildBlock(
    spec({ form: "timeline", label: "title", start: "startedAt", end: "doneAt" }),
    answered,
  );
  assert.ok(built.ok && built.block.form === "timeline");
  assert.equal(built.block.lanes.length, 4);
  assert.equal(built.block.undated, 1);
  const open = built.block.lanes.find((lane) => lane.id === "jira:SYN-3");
  assert.equal(open?.end, null);
  assert.ok(built.block.lanes.some((lane) => lane.earlier));
  assert.match(built.block.caption, /a bar from the left edge started by Sep 7/i);
  const grouped = buildBlock(
    spec({ form: "timeline", label: "title", start: "startedAt", end: "doneAt", by: "epic" }),
    answered,
  );
  assert.ok(grouped.ok && grouped.block.form === "timeline");
  assert.deepEqual(
    grouped.block.lanes.map((lane) => [lane.label, lane.count, lane.ended, lane.end]),
    [["Payments", 4, 3, null]],
  );
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
  assert.ok(!dims.includes("title") || history.items.length <= 200);
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
