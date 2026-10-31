import assert from "node:assert/strict";
import { test } from "node:test";
import { nav } from "../src/nav.ts";
import { init, type Model, update } from "../src/root.ts";
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

test("every page but a review link loads what the sidebar shows, the folder included", () => {
  const urls = (route: Route) =>
    init(route)[1].flatMap((effect) => (effect.type === "http" ? [effect.url] : []));
  for (const route of [
    { page: "window", grouping: "epic", addTo: null },
    { page: "group", id: groupA },
    { page: "thread", id: "01JBZ0000000000000000000T1" },
    { page: "inbox" },
  ] as const)
    for (const url of ["/api/groups", "/api/threads", "/api/folder"])
      assert.ok(urls(route).includes(url), `${route.page} loads ${url}`);
  assert.deepEqual(
    urls({ page: "review", token: "abc_DEF-123" }).filter((url) => !url.startsWith("/api/review")),
    [],
  );
});

test("a drop on a group's page updates the page, and the groups reload for their counts", () => {
  const [model] = init({ page: "group", id: groupA });
  const view = { group: group(groupA, "Launch"), members: [], changes: [], threads: [] };
  const [after, effects] = update(model, {
    type: "replied",
    tag: { kind: "dropped", groupId: groupA },
    ok: true,
    body: { group: view, added: ["jira:OA-5"], refused: [] },
  });
  assert.equal(after.group?.view, view);
  assert.ok(effects.some((effect) => effect.type === "http" && effect.url === "/api/groups"));
});

test("a turn that ends reloads the threads and the groups, whose dots and counts it may move", () => {
  const [model] = init({ page: "thread", id: "01JBZ0000000000000000000T1" });
  const [, effects] = update(model, {
    type: "streamed",
    event: { type: "status", running: false, state: "done", regionVersion: 1 },
  });
  const urls = effects.flatMap((effect) => (effect.type === "http" ? [effect.url] : []));
  assert.ok(urls.includes("/api/threads") && urls.includes("/api/groups"));
});
