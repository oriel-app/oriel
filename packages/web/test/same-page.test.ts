// Clicking the page already open does nothing to it: a link to it from the
// sidebar, Needs you, a nav item or a search keeps it as it is, its draft
// and its panel too, makes no request, and at most scrolls to the change set
// it names. Another page still opens.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Effect } from "../src/http.ts";
import { init, type Model, type Msg, update } from "../src/root.ts";
import type { Route } from "../src/route.ts";
import type { SearchView } from "../src/view.ts";
import { changeSetView, searchResult, threadView, workstreamView } from "../testing.ts";

const threadId = "01JBZ0000000000000000000T1";
const otherId = "01JBZ0000000000000000000T2";
const workstreamId = "01JBZ0000000000000000000G1";
const setId = "01JBZ0000000000000000000C1";

function run(model: Model, ...msgs: Msg[]): [Model, Effect[]] {
  let effects: Effect[] = [];
  for (const msg of msgs) [model, effects] = update(model, msg);
  return [model, effects];
}

const clicked = (route: Route): Msg => ({ type: "linkClicked", route });

// A thread's page, loaded, with a draft typed and an item open in the panel.
function onThread(): Model {
  const [model] = run(
    init({ page: "thread", id: threadId, item: "jira:SYN-1" })[0],
    {
      type: "replied",
      tag: { kind: "thread", id: threadId },
      ok: true,
      body: threadView({ id: threadId, changeSets: [changeSetView({ id: setId })] }),
    },
    { type: "thread", msg: { type: "draftChanged", text: "Half a thought" } },
  );
  return model;
}

test("a link to the thread already open makes no request and leaves it as it is", () => {
  const model = onThread();
  const [after, effects] = update(model, clicked({ page: "thread", id: threadId }));
  assert.deepEqual(effects, []);
  assert.equal(after, model);
  assert.equal(after.thread?.draft, "Half a thought");
  assert.equal(after.panel?.id, "jira:SYN-1");
});

test("a link to a change set of the thread already open only scrolls to it", () => {
  const [, effects] = update(
    onThread(),
    clicked({ page: "thread", id: threadId, changeSet: setId }),
  );
  assert.deepEqual(effects, [{ type: "showChangeSet", changeSetId: setId }]);
});

test("a search result for the thread already open, or its change set, opens nothing", () => {
  const found = (changeSet: string | null) =>
    searchResult({
      thread: {
        id: threadId,
        title: "Plan",
        state: "working",
        workstream: { id: workstreamId, name: "Launch" },
      },
      changeSet: changeSet === null ? null : { id: changeSet, state: "pending" },
    });
  const [shown] = run(
    onThread(),
    { type: "search", msg: { type: "typed", text: "plan" } },
    {
      type: "replied",
      tag: { kind: "search", request: 1 },
      ok: true,
      body: { query: "plan", results: [found(null), found(setId)] } satisfies SearchView,
    },
  );
  const picked = (index: number) =>
    update(shown, { type: "search", msg: { type: "picked", index } })[1].filter(
      (e) => e.type === "navigate" || e.type === "showChangeSet",
    );
  assert.deepEqual(picked(0), []);
  assert.deepEqual(picked(1), [{ type: "showChangeSet", changeSetId: setId }]);
});

test("a link to the workstream, window or Done page already open makes no request", () => {
  const [onWorkstream] = run(init({ page: "workstream", id: workstreamId })[0], {
    type: "replied",
    tag: { kind: "workstream", id: workstreamId },
    ok: true,
    body: workstreamView(),
  });
  assert.deepEqual(update(onWorkstream, clicked({ page: "workstream", id: workstreamId }))[1], []);
  const window: Route = { page: "window", grouping: "epic", addTo: null };
  assert.deepEqual(update(init(window)[0], clicked(window))[1], []);
  assert.deepEqual(update(init({ page: "done" })[0], clicked({ page: "done" }))[1], []);
});

test("a link to another page still goes there", () => {
  const model = onThread();
  for (const route of [
    { page: "thread", id: otherId },
    { page: "workstream", id: workstreamId },
    { page: "done", tab: "dropped" },
  ] satisfies Route[])
    assert.deepEqual(update(model, clicked(route))[1], [{ type: "navigate", route }]);
  // So does opening an item in the panel beside the page.
  const [, opened] = update(model, { type: "itemOpened", id: "jira:SYN-2" });
  assert.deepEqual(opened, [
    {
      type: "navigate",
      route: { page: "thread", id: threadId, item: "jira:SYN-2" },
      stay: true,
      replace: true,
    },
  ]);
});

test("a link to the open page that isn't there yet, or a new draft, still goes", () => {
  // A thread that didn't load opens again from its link.
  const route: Route = { page: "thread", id: threadId };
  const [failed] = run(init(route)[0], {
    type: "replied",
    tag: { kind: "thread", id: threadId },
    ok: false,
    body: { error: "Oriel can't be reached. Is it still running?" },
  });
  assert.deepEqual(update(failed, clicked(route))[1], [{ type: "navigate", route }]);
  // Each New thread is a new draft.
  const draft: Route = { page: "new-thread" };
  assert.deepEqual(update(init(draft)[0], clicked(draft))[1], [{ type: "navigate", route: draft }]);
  // A change set the thread doesn't have, as from a stale link, opens it at
  // its latest entry, as it always did.
  const stale: Route = { page: "thread", id: threadId, changeSet: "01JBZ0000000000000000000C9" };
  assert.deepEqual(update(onThread(), clicked(stale))[1], [{ type: "navigate", route: stale }]);
  // A link that opens an item opens it in the panel.
  const item: Route = { page: "thread", id: threadId, item: "jira:SYN-2" };
  assert.deepEqual(update(onThread(), clicked(item))[1], [{ type: "navigate", route: item }]);
});
