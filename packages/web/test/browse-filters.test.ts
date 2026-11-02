// Browse's item search and filters (decision 0027), in its address: the
// search asks once typing pauses, a filter at once, and a new query is
// counted by its length and opens the clusters with matches.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Effect } from "../src/http.ts";
import { init as initRoot, type Model as Root, update as updateRoot } from "../src/root.ts";
import { parseRoute, routeUrl } from "../src/route.ts";
import { init, type Model, type Msg, update } from "../src/update.ts";
import { clusterRow, windowView } from "../testing.ts";

const step = (model: Model, msg: Msg) => update(model, msg);

function shown(): Model {
  const [model] = init("epic");
  return step(model, {
    type: "windowLoaded",
    request: model.request,
    window: windowView({ grouping: "epic", clusters: [] }),
  })[0];
}

const loads = (effects: Effect[]) => effects.filter((effect) => effect.type === "loadWindow");

test("the filters are in Browse's address, in one order, and a status it doesn't know is dropped", () => {
  const route = parseRoute("/browse", "?grouping=epic&source=slack&q=sms&status=done&assignee=a1");
  assert.deepEqual(route, {
    page: "window",
    grouping: "epic",
    addTo: null,
    q: "sms",
    source: "slack",
    status: "done",
    assignee: "a1",
  });
  assert.equal(routeUrl(route), "/browse?grouping=epic&q=sms&source=slack&status=done&assignee=a1");
  assert.deepEqual(parseRoute("/browse", "?q=%20&status=blocked"), {
    page: "window",
    grouping: "epic",
    addTo: null,
  });
});

test("typing searches once it pauses; an earlier pause, or the same query, asks nothing", () => {
  let model = shown();
  let effects: Effect[];
  [model, effects] = step(model, { type: "queryTyped", text: "sm" });
  const first = model.typed;
  assert.deepEqual(
    effects.map((effect) => effect.type),
    ["after"],
  );
  [model] = step(model, { type: "queryTyped", text: "sms" });
  assert.deepEqual(step(model, { type: "queryPaused", typed: first })[1], []);
  [model, effects] = step(model, { type: "queryPaused", typed: model.typed });
  assert.deepEqual(model.filter, { q: "sms" });
  assert.deepEqual(effects, [
    { type: "loadWindow", request: model.request, grouping: "epic", filter: { q: "sms" } },
    { type: "showFilter", filter: { q: "sms" } },
  ]);
  // Typed again to the same query, nothing loads.
  [model] = step(model, { type: "queryTyped", text: "sms " });
  assert.deepEqual(step(model, { type: "queryPaused", typed: model.typed })[1], []);
  // Emptied, it goes at once.
  [model, effects] = step(model, { type: "queryTyped", text: "" });
  assert.deepEqual(model.filter, {});
  assert.deepEqual(effects, [
    { type: "loadWindow", request: model.request, grouping: "epic" },
    { type: "showFilter", filter: {} },
  ]);
});

test("a new query is counted by its length and what it found, and opens the clusters with matches", () => {
  let [model] = step(shown(), { type: "filterPicked", filter: { q: "café", source: "slack" } });
  const filter = { q: "café", source: "slack" };
  const [loaded, effects] = step(model, {
    type: "windowLoaded",
    request: model.request,
    window: windowView({
      grouping: "epic",
      items: 3,
      clusters: [
        { row: clusterRow({ key: "a", label: "A", count: 9 }), list: [], matched: 2 },
        { row: clusterRow({ key: "b", label: "B", count: 4 }), list: [], matched: 0 },
        { row: clusterRow({ key: "c", label: "C", count: 1 }), list: [], matched: 1 },
      ],
    }),
  });
  assert.deepEqual(loaded.open.epic, ["a", "c"]);
  const [counted, ...pages] = effects;
  assert.deepEqual(counted, {
    type: "http",
    method: "POST",
    url: "/api/telemetry",
    body: { name: "items.searched", queryLength: 4, results: 3 },
    tag: { kind: "telemetry" },
  });
  assert.deepEqual(
    pages.map((page) => page.type === "loadItems" && [page.cluster, page.from, page.filter]),
    [
      ["a", 0, filter],
      ["c", 0, filter],
    ],
  );
  // Loaded again for the same query, as after a sync, it isn't counted again.
  [model] = step(loaded, { type: "retryClicked" });
  const again = step(model, {
    type: "windowLoaded",
    request: model.request,
    window: windowView({ grouping: "epic", clusters: [] }),
  })[1];
  assert.ok(!again.some((effect) => effect.type === "http"));
});

test("a filter picked loads at once; Clear filters empties them and the search box", () => {
  let [model, effects] = step(shown(), { type: "filterPicked", filter: { status: "done" } });
  assert.deepEqual(loads(effects), [
    { type: "loadWindow", request: model.request, grouping: "epic", filter: { status: "done" } },
  ]);
  [model] = step(model, { type: "queryTyped", text: "sms" });
  [model, effects] = step(model, { type: "filtersCleared" });
  assert.deepEqual([model.filter, model.query], [{}, ""]);
  assert.deepEqual(effects.at(-1), { type: "showFilter", filter: {} });
});

test("the address naming other filters, as Back does, loads them without writing the address", () => {
  const [model, effects] = step(shown(), {
    type: "filterRouted",
    filter: { q: "sms", source: "slack" },
  });
  assert.deepEqual([model.filter, model.query], [{ q: "sms", source: "slack" }, "sms"]);
  assert.deepEqual(
    effects.map((effect) => effect.type),
    ["loadWindow"],
  );
  assert.deepEqual(
    step(model, { type: "filterRouted", filter: { source: "slack", q: "sms" } })[1],
    [],
  );
});

test("Browse opened at an address with a query counts it once it loads", () => {
  const [model, effects] = init("epic", null, { q: "sms" });
  assert.deepEqual(effects, [
    { type: "loadWindow", request: model.request, grouping: "epic", filter: { q: "sms" } },
  ]);
  assert.equal(model.query, "sms");
  const counted = step(model, {
    type: "windowLoaded",
    request: model.request,
    window: windowView({ grouping: "epic", items: 0 }),
  })[1];
  assert.equal(counted.length, 1);
});

test("a query picked while another loads is still counted, and opens its matches", () => {
  let [model] = step(shown(), { type: "filterPicked", filter: { q: "sms" } });
  [model] = step(model, { type: "filterPicked", filter: { q: "sms", source: "slack" } });
  const [loaded, effects] = step(model, {
    type: "windowLoaded",
    request: model.request,
    window: windowView({
      grouping: "epic",
      items: 1,
      clusters: [{ row: clusterRow({ key: "a", label: "A", count: 3 }), list: [], matched: 1 }],
    }),
  });
  assert.deepEqual(loaded.open.epic, ["a"]);
  assert.ok(effects.some((effect) => effect.type === "http" && effect.url === "/api/telemetry"));
});

// The window under the root, at an address, loaded with no clusters.
function root(search: string): Root {
  const [model] = initRoot(parseRoute("/browse", search));
  const window = model.window;
  assert.ok(window);
  return updateRoot(model, {
    type: "window",
    msg: {
      type: "windowLoaded",
      request: window.request,
      window: windowView({ grouping: "epic", clusters: [] }),
    },
  })[0];
}

test("the page's address follows a search, so an item opened beside it keeps the search", () => {
  let model = root("?grouping=epic");
  [model] = updateRoot(model, {
    type: "window",
    msg: { type: "filterPicked", filter: { q: "sms" } },
  });
  assert.equal(routeUrl(model.route), "/browse?grouping=epic&q=sms");
  const [, effects] = updateRoot(model, { type: "itemOpened", id: "jira:SYN-61" });
  const opened = effects.find((effect) => effect.type === "navigate");
  assert.ok(opened?.type === "navigate");
  assert.equal(routeUrl(opened.route), "/browse?grouping=epic&q=sms&item=jira%3ASYN-61");
});

test("clusters a search opens as it loads aren't counted as the user zooming in", () => {
  const [model] = initRoot(parseRoute("/browse", "?grouping=epic&q=sms"));
  assert.ok(model.window);
  const [loaded, effects] = updateRoot(model, {
    type: "window",
    msg: {
      type: "windowLoaded",
      request: model.window.request,
      window: windowView({
        grouping: "epic",
        items: 1,
        clusters: [{ row: clusterRow({ key: "a", label: "A", count: 3 }), list: [], matched: 1 }],
      }),
    },
  });
  assert.deepEqual(loaded.window?.open.epic, ["a"]);
  const reported = effects.flatMap((effect) =>
    effect.type === "http" && effect.url === "/api/telemetry"
      ? [(effect.body as { name: string }).name]
      : [],
  );
  assert.deepEqual(reported, ["items.searched"]);
});

test("a search cleared before it loads isn't counted, and opens nothing", () => {
  let [model] = step(shown(), { type: "filterPicked", filter: { q: "sms" } });
  [model] = step(model, { type: "filtersCleared" });
  const [loaded, effects] = step(model, {
    type: "windowLoaded",
    request: model.request,
    window: windowView({
      grouping: "epic",
      clusters: [{ row: clusterRow({ key: "a", label: "A", count: 3 }), list: [] }],
    }),
  });
  assert.deepEqual([loaded.open.epic, effects], [[], []]);
});

test("while other filters load, the window on screen asks for no pages under them", () => {
  const [model] = init("epic");
  let [open] = step(
    step(model, {
      type: "windowLoaded",
      request: model.request,
      window: windowView({
        grouping: "epic",
        clusters: [{ row: clusterRow({ key: "a", label: "A", count: 120 }), list: [] }],
      }),
    })[0],
    { type: "clusterToggled", key: "a" },
  );
  open = step(open, {
    type: "itemsLoaded",
    request: open.pageRequest,
    page: {
      grouping: "epic",
      cluster: "a",
      of: "x",
      from: 0,
      items: [],
      total: 120,
      locations: {},
    },
  })[0];
  const [loading] = step(open, { type: "filterPicked", filter: { status: "done" } });
  assert.deepEqual(step(loading, { type: "moreClicked", key: "a" })[1], []);
});
