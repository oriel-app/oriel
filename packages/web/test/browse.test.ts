// Browse loads a cluster's items when it opens, 50 at a time (decision
// 0027), at its own address.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRoute, routeUrl } from "../src/route.ts";
import { init, type Model, type Msg, pickedName, update } from "../src/update.ts";
import type { ItemRow } from "../src/view.ts";
import { clusterPageView, clusterRow, itemRow, windowView } from "../testing.ts";

const rows = (from: number, count: number): ItemRow[] =>
  Array.from({ length: count }, (_, n) =>
    itemRow({ id: `jira:SYN-${from + n + 1}`, key: `SYN-${from + n + 1}` }),
  );

// The epic grouping shown, with one cluster of 120 items and one of none,
// each with no items loaded.
function shown(): Model {
  const [model] = init("epic");
  return update(model, {
    type: "windowLoaded",
    request: model.request,
    window: windowView({
      grouping: "epic",
      clusters: [
        { row: clusterRow({ key: "big", label: "Big", count: 120 }), list: [] },
        { row: clusterRow({ key: "empty", label: "Empty", count: 0 }), list: [] },
      ],
      items: 120,
    }),
  })[0];
}

const step = (model: Model, msg: Msg) => update(model, msg);
const listOf = (model: Model, key: string) =>
  model.window?.clusters.find(({ row }) => row.key === key)?.list ?? [];

test("opening a cluster asks for its first page of items, once", () => {
  const [open, effects] = step(shown(), { type: "clusterToggled", key: "big" });
  assert.deepEqual(effects, [
    { type: "loadItems", request: open.pageRequest, grouping: "epic", cluster: "big", from: 0 },
  ]);
  assert.equal(open.paging["big"], open.pageRequest);
  // Closed and opened again while it is on its way, it isn't asked for twice.
  const closed = step(open, { type: "clusterToggled", key: "big" })[0];
  assert.deepEqual(step(closed, { type: "clusterToggled", key: "big" })[1], []);
  // Opened again once it has items, it shows them and asks for no more.
  const loaded = step(open, {
    type: "itemsLoaded",
    request: open.pageRequest,
    page: clusterPageView({ cluster: "big", items: rows(0, 50), total: 120 }),
  })[0];
  const shut = step(loaded, { type: "clusterToggled", key: "big" })[0];
  assert.deepEqual(step(shut, { type: "clusterToggled", key: "big" })[1], []);
  // A cluster with no items asks for none.
  assert.deepEqual(step(shown(), { type: "clusterToggled", key: "empty" })[1], []);
});

test("each page follows the last, until the cluster's items are all shown", () => {
  let [model] = step(shown(), { type: "clusterToggled", key: "big" });
  const page = (from: number, count: number) =>
    clusterPageView({
      cluster: "big",
      from,
      items: rows(from, count),
      total: 120,
      locations: { [`jira:SYN-${from + 1}`]: `https://example.test/${from + 1}` },
    });
  model = step(model, { type: "itemsLoaded", request: model.pageRequest, page: page(0, 50) })[0];
  assert.equal(listOf(model, "big").length, 50);
  assert.equal(model.paging["big"], undefined);
  assert.equal(model.window?.locations?.["jira:SYN-1"], "https://example.test/1");
  let effects;
  [model, effects] = step(model, { type: "moreClicked", key: "big" });
  assert.deepEqual(effects, [
    { type: "loadItems", request: model.pageRequest, grouping: "epic", cluster: "big", from: 50 },
  ]);
  model = step(model, { type: "itemsLoaded", request: model.pageRequest, page: page(50, 50) })[0];
  [model] = step(model, { type: "moreClicked", key: "big" });
  model = step(model, { type: "itemsLoaded", request: model.pageRequest, page: page(100, 20) })[0];
  assert.deepEqual(
    listOf(model, "big").map((item) => item.key),
    rows(0, 120).map((item) => item.key),
  );
  assert.equal(model.window?.locations?.["jira:SYN-51"], "https://example.test/51");
  // Nothing is left to ask for.
  assert.deepEqual(step(model, { type: "moreClicked", key: "big" })[1], []);
});

test("a page for a request since replaced, or for another grouping, is dropped", () => {
  const [open] = step(shown(), { type: "clusterToggled", key: "big" });
  const page = clusterPageView({ cluster: "big", items: rows(0, 50), total: 120 });
  const stale = step(open, { type: "itemsLoaded", request: open.pageRequest - 1, page })[0];
  assert.equal(stale, open);
  const other = step(open, {
    type: "itemsLoaded",
    request: open.pageRequest,
    page: { ...page, grouping: "assignee" },
  })[0];
  assert.equal(other, open);
});

test("a page that didn't load says so, and can be asked for again", () => {
  const [open] = step(shown(), { type: "clusterToggled", key: "big" });
  const failed = step(open, {
    type: "itemsFailed",
    request: open.pageRequest,
    key: "big",
    from: 0,
  })[0];
  assert.equal(failed.paging["big"], "failed");
  const [again, effects] = step(failed, { type: "moreClicked", key: "big" });
  assert.deepEqual(effects, [
    { type: "loadItems", request: again.pageRequest, grouping: "epic", cluster: "big", from: 0 },
  ]);
});

test("a window loaded again keeps an open cluster's items until its first page comes again", () => {
  let [model] = step(shown(), { type: "clusterToggled", key: "big" });
  model = step(model, {
    type: "itemsLoaded",
    request: model.pageRequest,
    page: clusterPageView({ cluster: "big", items: rows(0, 50), total: 120 }),
  })[0];
  [model] = step(model, { type: "retryClicked" });
  const [reloaded, effects] = step(model, {
    type: "windowLoaded",
    request: model.request,
    window: windowView({
      grouping: "epic",
      clusters: [{ row: clusterRow({ key: "big", label: "Big", count: 121 }), list: [] }],
    }),
  });
  assert.equal(listOf(reloaded, "big").length, 50);
  assert.deepEqual(effects, [
    { type: "loadItems", request: reloaded.pageRequest, grouping: "epic", cluster: "big", from: 0 },
  ]);
  const first = step(reloaded, {
    type: "itemsLoaded",
    request: reloaded.pageRequest,
    page: clusterPageView({ cluster: "big", items: rows(1, 50), total: 121 }),
  })[0];
  assert.deepEqual(
    listOf(first, "big").map((item) => item.key),
    rows(1, 50).map((item) => item.key),
  );
});

test("a page whose cluster holds a different count now loads the window again", () => {
  const [open] = step(shown(), { type: "clusterToggled", key: "big" });
  const [next, effects] = step(open, {
    type: "itemsLoaded",
    request: open.pageRequest,
    page: clusterPageView({ cluster: "big", items: rows(0, 50), total: 119 }),
  });
  assert.equal(next.status, "loading");
  assert.deepEqual(effects, [{ type: "loadWindow", request: next.request, grouping: "epic" }]);
});

test("Browse has its own address, with its grouping, and the old one still opens it", () => {
  const route = { page: "window", grouping: "stuck", addTo: null } as const;
  assert.equal(routeUrl(route), "/browse?grouping=stuck");
  assert.deepEqual(parseRoute("/browse", "?grouping=stuck"), route);
  assert.deepEqual(parseRoute("/", "?grouping=stuck"), route);
  assert.deepEqual(parseRoute("/", ""), { ...route, grouping: "epic" });
});

test("a later page from another list than the first page's loads the window again", () => {
  let [model] = step(shown(), { type: "clusterToggled", key: "big" });
  const page = (from: number, of: string) =>
    clusterPageView({ cluster: "big", of, from, items: rows(from, 50), total: 120 });
  model = step(model, { type: "itemsLoaded", request: model.pageRequest, page: page(0, "a") })[0];
  [model] = step(model, { type: "moreClicked", key: "big" });
  const same = step(model, {
    type: "itemsLoaded",
    request: model.pageRequest,
    page: page(50, "a"),
  });
  assert.equal(listOf(same[0], "big").length, 100);
  const [moved, effects] = step(model, {
    type: "itemsLoaded",
    request: model.pageRequest,
    page: page(50, "b"),
  });
  assert.equal(moved.status, "loading");
  assert.deepEqual(effects, [{ type: "loadWindow", request: moved.request, grouping: "epic" }]);
});

test("a first page that fails after a reload shows the failure, not the items from before", () => {
  let [model] = step(shown(), { type: "clusterToggled", key: "big" });
  model = step(model, {
    type: "itemsLoaded",
    request: model.pageRequest,
    page: clusterPageView({ cluster: "big", items: rows(0, 50), total: 120 }),
  })[0];
  [model] = step(model, { type: "retryClicked" });
  [model] = step(model, {
    type: "windowLoaded",
    request: model.request,
    window: windowView({
      grouping: "epic",
      clusters: [{ row: clusterRow({ key: "big", label: "Big", count: 120 }), list: [] }],
    }),
  });
  const failed = step(model, {
    type: "itemsFailed",
    request: model.pageRequest,
    key: "big",
    from: 0,
  })[0];
  assert.deepEqual(listOf(failed, "big"), []);
  const [, effects] = step(failed, { type: "moreClicked", key: "big" });
  assert.deepEqual(
    effects.map((effect) => effect.type === "loadItems" && effect.from),
    [0],
  );
});

test("a picked item names its workstream once the window no longer shows it", () => {
  let [model] = step(shown(), { type: "clusterToggled", key: "big" });
  const epic = itemRow({ id: "jira:SYN-500", key: "SYN-500", title: "Big epic", type: "Epic" });
  model = {
    ...model,
    window: model.window && {
      ...model.window,
      clusters: model.window.clusters.map((cluster) =>
        cluster.row.key === "big" ? { ...cluster, row: { ...cluster.row, anchor: epic } } : cluster,
      ),
    },
  };
  model = step(model, {
    type: "itemsLoaded",
    request: model.pageRequest,
    page: clusterPageView({ cluster: "big", items: rows(0, 50), total: 120 }),
  })[0];
  model = step(model, { type: "itemToggled", id: "jira:SYN-1" })[0];
  model = step(model, { type: "itemToggled", id: "jira:SYN-2" })[0];
  assert.equal(pickedName(model), "Big");
  // Another grouping, whose clusters have no items loaded yet.
  [model] = step(model, { type: "groupingPicked", grouping: "assignee" });
  [model] = step(model, {
    type: "windowLoaded",
    request: model.request,
    window: windowView({
      grouping: "assignee",
      clusters: [{ row: clusterRow({ key: "person:a", label: "Ana", count: 2 }), list: [] }],
    }),
  });
  assert.equal(pickedName(model), "Big");
  // Shown there too, they are still the epic's.
  const ana = model.window?.clusters[0];
  assert.ok(ana);
  const showing = {
    ...model,
    window: model.window && {
      ...model.window,
      clusters: [{ ...ana, list: rows(0, 2) }],
    },
  };
  assert.equal(pickedName(showing), "Big");
  model = step(model, { type: "itemToggled", id: "jira:SYN-1" })[0];
  assert.equal(pickedName(model), "Title SYN-1");
  model = step(model, { type: "selectionCleared" })[0];
  assert.deepEqual(model.picks, {});
});
