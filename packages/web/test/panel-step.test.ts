// From an open panel (OA-95): next and previous step through the list it was
// opened from, without reloading the page, and the item can be added to the
// workstream the page is about (panel-add-back.test.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Effect } from "../src/http.ts";
import { placeIn, stepped } from "../src/panel.ts";
import { currentWorkstream, init, type Model, type Msg, update } from "../src/root.ts";
import type { Route } from "../src/route.ts";
import { itemRef, memberView, threadView, workstreamSummary, workstreamView } from "../testing.ts";

const workstream = "01JBZ0000000000000000000G1";
const list = ["jira:SYN-1", "jira:SYN-2", "jira:SYN-3"];

// Runs a message, then each navigate it asks for, as the browser would.
function run(model: Model, msg: Msg): [Model, Effect[]] {
  const [next, effects] = update(model, msg);
  return effects.reduce<[Model, Effect[]]>(
    ([at, all], effect) => {
      if (effect.type !== "navigate") return [at, [...all, effect]];
      const [routed, more] = update(at, { type: "routed", route: effect.route });
      return [routed, [...all, effect, ...more]];
    },
    [next, []],
  );
}

const navigations = (effects: readonly Effect[]) =>
  effects.flatMap((effect) => (effect.type === "navigate" ? [effect] : []));
const loads = (effects: readonly Effect[]) =>
  effects.flatMap((effect) => (effect.type === "http" ? [`${effect.method} ${effect.url}`] : []));

const opened = (route: Route, id = "jira:SYN-2") => {
  const [start] = init(route);
  return run(start, { type: "itemOpened", id, list });
};

test("stepping opens the next or previous item in the list, in the open item's place in history", () => {
  const page: Route = { page: "window", grouping: "epic", addTo: null };
  const [model] = opened(page);
  assert.deepEqual(placeIn(model.panelList, "jira:SYN-2"), { index: 1, count: 3 });
  const [next, effects] = run(model, { type: "panelStepped", by: 1 });
  assert.deepEqual(navigations(effects), [
    { type: "navigate", route: { ...page, item: "jira:SYN-3" }, stay: true, replace: true },
  ]);
  assert.equal(next.panel?.id, "jira:SYN-3");
  // The page stays as it is: only the item is read.
  assert.deepEqual(loads(effects), ["GET /api/items/jira%3ASYN-3", "POST /api/telemetry"]);
  const [back] = run(next, { type: "panelStepped", by: -1 });
  assert.equal(back.panel?.id, "jira:SYN-2");
});

test("stepping stops at either end of the list, and past the rows that had loaded", () => {
  const [first] = opened({ page: "window", grouping: "epic", addTo: null }, "jira:SYN-1");
  assert.deepEqual(run(first, { type: "panelStepped", by: -1 })[1], []);
  const [last] = opened({ page: "window", grouping: "epic", addTo: null }, "jira:SYN-3");
  assert.deepEqual(run(last, { type: "panelStepped", by: 1 })[1], []);
  assert.equal(stepped(list, "jira:SYN-3", 1), null);
  assert.equal(stepped(list, "jira:SYN-9", 1), null);
});

test("an item opened from no list, or by its address, has nothing to step through", () => {
  const [start] = init({ page: "window", grouping: "epic", addTo: null });
  const [model] = run(start, { type: "itemOpened", id: "jira:SYN-2" });
  assert.equal(model.panelList, null);
  assert.deepEqual(run(model, { type: "panelStepped", by: 1 })[1], []);
  const [addressed] = init({ page: "window", grouping: "epic", addTo: null, item: "jira:SYN-2" });
  assert.equal(placeIn(addressed.panelList, "jira:SYN-2"), null);
});

test("another page forgets the list; the same page with another item keeps it", () => {
  const [model] = opened({ page: "window", grouping: "epic", addTo: null });
  const [elsewhere] = update(model, {
    type: "routed",
    route: { page: "workstream", id: workstream, item: "jira:SYN-2" },
  });
  assert.equal(elsewhere.panelList, null);
  const [same] = update(model, {
    type: "routed",
    route: { page: "window", grouping: "epic", addTo: null, item: "jira:SYN-1" },
  });
  assert.deepEqual(same.panelList, list);
});

const withWorkstream = (model: Model): Model => ({
  ...model,
  workstreams: [workstreamSummary({ id: workstream, name: "Fares" })],
});

test("the current workstream is the page's, or the one the window is adding to; elsewhere none", () => {
  const [window] = init({ page: "window", grouping: "epic", addTo: null });
  assert.equal(currentWorkstream(withWorkstream(window)), null);
  const [adding] = init({ page: "window", grouping: "epic", addTo: workstream });
  assert.deepEqual(currentWorkstream(withWorkstream(adding)), {
    id: workstream,
    name: "Fares",
    members: null,
  });
  const [page] = init({ page: "workstream", id: workstream });
  assert.equal(currentWorkstream(page), null);
  const loaded: Model = page.workstream
    ? {
        ...page,
        workstream: {
          ...page.workstream,
          view: workstreamView({
            workstream: workstreamSummary({ id: workstream, name: "Fares" }),
            members: [memberView({ ref: itemRef({ id: "jira:SYN-1" }) })],
          }),
        },
      }
    : page;
  const found = currentWorkstream(loaded);
  assert.equal(found?.name, "Fares");
  assert.ok(found?.members?.has("jira:SYN-1"));
  const [done] = init({ page: "done" });
  assert.equal(currentWorkstream(done), null);
});

test("on a thread's page, its region tells members only while it is the workstream's latest", () => {
  const [page] = init({ page: "thread", id: "01JBZ0000000000000000000T1" });
  const at = (regionVersion: number): Model =>
    page.thread
      ? {
          ...page,
          thread: {
            ...page.thread,
            view: threadView({
              workstream: { id: workstream, name: "Fares", version: 2 },
              regionVersion,
              members: [memberView({ ref: itemRef({ id: "jira:SYN-1" }) })],
            }),
          },
        }
      : page;
  assert.ok(currentWorkstream(at(2))?.members?.has("jira:SYN-1"));
  assert.deepEqual(currentWorkstream(at(1)), { id: workstream, name: "Fares", members: null });
});
