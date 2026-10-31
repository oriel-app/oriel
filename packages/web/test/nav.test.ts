import assert from "node:assert/strict";
import { test } from "node:test";
import { nav } from "../src/nav.ts";
import { init, type Model, update } from "../src/root.ts";
import type { Route } from "../src/route.ts";
import {
  type ChangeSetStatus,
  type GroupSummary,
  type ThreadSummaryView,
  waitingOn,
} from "../src/view.ts";

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
  waitingOn: ThreadSummaryView["waitingOn"] = null,
): ThreadSummaryView => ({
  id,
  title: `Thread ${id}`,
  group: { id: groupId, name: groupId === groupA ? "Launch" : "Billing" },
  state,
  doneBy: null,
  waitingOn,
  activityAt,
});

const at = (route: Route, lists = true): Model => ({
  ...init(route)[0],
  groups: lists ? [group(groupA, "Launch"), group(groupB, "Billing")] : null,
  threads: lists
    ? [
        thread("T1", groupA, "done", "2026-10-29T09:00:00.000Z"),
        thread("T2", groupA, "working", "2026-10-30T09:00:00.000Z", "agent"),
        thread("T3", groupB, "working", "2026-10-28T09:00:00.000Z", "review"),
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
  // T2's agent is mid-turn; T3 has a change set for the user to review.
  assert.equal(where.needsYou, 1);
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
  assert.equal(where.needsYou, 0);
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

test("a drop on a thread reaches the thread, even after a visit to its group's page", () => {
  const thread = "01JBZ0000000000000000000T1";
  const onGroup = init({ page: "group", id: groupA })[0];
  const [entered] = update(onGroup, { type: "routed", route: { page: "thread", id: thread } });
  assert.notEqual(entered.group, null);
  // The thread has loaded, in group A.
  const loaded = { ...entered.thread, view: { group: { id: groupA } } } as Model["thread"];
  const [, effects] = update(
    { ...entered, thread: loaded },
    {
      type: "replied",
      tag: { kind: "dropped", groupId: groupA },
      ok: true,
      body: { group: {}, added: ["jira:OA-5"], refused: [] },
    },
  );
  const urls = effects.flatMap((effect) => (effect.type === "http" ? [effect.url] : []));
  assert.ok(urls.includes(`/api/threads/${thread}`), "the thread reloads to show its marker");
  assert.ok(urls.includes("/api/groups"));
});

test("a drop that answers after the user moved on still reloads the groups", () => {
  const onGroup = init({ page: "group", id: groupA })[0];
  const [onInbox] = update(onGroup, { type: "routed", route: { page: "inbox" } });
  const [, effects] = update(onInbox, {
    type: "replied",
    tag: { kind: "dropped", groupId: groupA },
    ok: true,
    body: { group: {}, added: ["jira:OA-5"], refused: [] },
  });
  assert.ok(effects.some((effect) => effect.type === "http" && effect.url === "/api/groups"));
});

test("every page but a review link watches the threads, and a move reloads both lists", () => {
  const watches = (route: Route) => init(route)[1].some((effect) => effect.type === "watchThreads");
  assert.ok(watches({ page: "inbox" }));
  assert.ok(watches({ page: "thread", id: "01JBZ0000000000000000000T1" }));
  assert.equal(watches({ page: "review", token: "abc_DEF-123" }), false);
  const [, effects] = update(init({ page: "inbox" })[0], { type: "threadsMoved" });
  assert.deepEqual(
    effects.flatMap((effect) => (effect.type === "http" ? [effect.url] : [])),
    ["/api/threads", "/api/groups"],
  );
});

test("a working thread waits on its agent mid-turn, then on a review or the user's reply", () => {
  const set = (status: ChangeSetStatus, ...steps: string[]) => ({
    status,
    nextSteps: steps.map((kind) => ({ kind })),
  });
  const working = { state: "working", running: false } as const;
  assert.equal(
    waitingOn({ ...working, running: true, changeSets: [set("open", "approve")] }),
    "agent",
  );
  // A change set waits on the user while the engine offers a step besides a
  // revert, or while it applies.
  assert.equal(waitingOn({ ...working, changeSets: [set("open", "approve", "reject")] }), "review");
  assert.equal(
    waitingOn({ ...working, changeSets: [set("partial", "retry", "dismiss", "revert")] }),
    "review",
  );
  assert.equal(waitingOn({ ...working, changeSets: [set("applying")] }), "review");
  // Applied, rejected, or partly applied and the rest dismissed: nothing to decide.
  assert.equal(waitingOn({ ...working, changeSets: [set("applied", "revert")] }), "reply");
  assert.equal(waitingOn({ ...working, changeSets: [set("rejected")] }), "reply");
  assert.equal(waitingOn({ ...working, changeSets: [set("partial", "revert")] }), "reply");
  assert.equal(waitingOn({ ...working, changeSets: [] }), "reply");
  for (const state of ["done", "handed-off", "dropped"] as const)
    assert.equal(
      waitingOn({ state, running: false, changeSets: [set("open", "approve")] }),
      null,
      state,
    );
});
