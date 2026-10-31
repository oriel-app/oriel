import assert from "node:assert/strict";
import { test } from "node:test";
import { nav } from "../src/nav.ts";
import { init, type Model } from "../src/root.ts";
import type { Route } from "../src/route.ts";
import type { GroupSummary, ThreadSummaryView } from "../src/view.ts";

const groupA = "01JBZ0000000000000000000G1";
const groupB = "01JBZ0000000000000000000G2";

const group = (id: string, name: string): GroupSummary => ({
  id,
  name,
  origin: { kind: "picked" },
  version: 1,
  size: 3,
  createdAt: "2026-10-29T09:00:00.000Z",
  threads: { working: 0, done: 0, "handed-off": 0, dropped: 0 },
});

const thread = (
  id: string,
  groupId: string,
  state: ThreadSummaryView["state"],
  activityAt: string,
): ThreadSummaryView => ({
  id,
  title: `Thread ${id}`,
  group: { id: groupId, name: groupId === groupA ? "Launch" : "Billing" },
  state,
  doneBy: null,
  activityAt,
});

const at = (route: Route, lists = true): Model => ({
  ...init(route)[0],
  groups: lists ? [group(groupA, "Launch"), group(groupB, "Billing")] : null,
  threads: lists
    ? [
        thread("T1", groupA, "done", "2026-10-29T09:00:00.000Z"),
        thread("T2", groupA, "working", "2026-10-30T09:00:00.000Z"),
        thread("T3", groupB, "working", "2026-10-28T09:00:00.000Z"),
      ]
    : null,
});

test("each group lists its own threads, most recently active first", () => {
  const where = nav(at({ page: "inbox" }));
  assert.deepEqual(
    where.groups?.map((entry) => [entry.group.name, entry.threads.map((each) => each.id)]),
    [
      ["Launch", ["T2", "T1"]],
      ["Billing", ["T3"]],
    ],
  );
  assert.equal(where.working, 2);
  assert.equal(where.thread, null);
  assert.ok(where.groups?.every((entry) => !entry.current));
});

test("the group on the page, or the group of the thread on it, is current", () => {
  const onGroup = nav(at({ page: "group", id: groupB }));
  assert.deepEqual(
    onGroup.groups?.map((entry) => entry.current),
    [false, true],
  );
  // The thread hasn't loaded yet: its group comes from the threads list.
  const onThread = nav(at({ page: "thread", id: "T1" }));
  assert.equal(onThread.thread, "T1");
  assert.deepEqual(
    onThread.groups?.map((entry) => entry.current),
    [true, false],
  );
});

test("before the lists load, there are no groups to show", () => {
  const where = nav(at({ page: "window", grouping: "epic", addTo: null }, false));
  assert.equal(where.groups, null);
  assert.equal(where.working, 0);
});
