import assert from "node:assert/strict";
import { test } from "node:test";
import { init, type Model, type Msg, update, zoomOf } from "../src/update.ts";
import type { ClusterView, GroupingId, WindowView } from "../src/view.ts";

function cluster(key: string): ClusterView {
  return {
    row: {
      key,
      label: key,
      origin: { kind: "source", source: "Jira" },
      anchor: null,
      count: 0,
      points: 0,
      unestimated: 0,
      status: { todo: 0, "in-progress": 0, done: 0 },
    },
    list: [],
  };
}

function view(grouping: GroupingId, keys: string[]): WindowView {
  return {
    grouping,
    clusters: keys.map(cluster),
    items: 0,
    asOf: "2026-10-29T09:00:00.000Z",
    fixture: true,
  };
}

function run(model: Model, ...msgs: Msg[]): Model {
  return msgs.reduce((current, msg) => update(current, msg)[0], model);
}

test("init loads the grouping the address bar names, else epic", () => {
  const [model, effects] = init("stuck");
  assert.equal(model.grouping, "stuck");
  assert.equal(model.status, "loading");
  assert.deepEqual(effects, [{ type: "loadWindow", request: model.request, grouping: "stuck" }]);
  assert.equal(init("nonsense")[0].grouping, "epic");
  assert.equal(init(null)[0].grouping, "epic");
});

test("a loaded window is shown", () => {
  const [model] = init("epic");
  const loaded = view("epic", ["a"]);
  const [next, effects] = update(model, {
    type: "windowLoaded",
    request: model.request,
    window: loaded,
  });
  assert.equal(next.status, "ready");
  assert.equal(next.window, loaded);
  assert.deepEqual(effects, []);
});

test("picking a grouping loads it and puts it in the address bar", () => {
  const [model] = init("epic");
  const [next, effects] = update(model, { type: "groupingPicked", grouping: "assignee" });
  assert.equal(next.grouping, "assignee");
  assert.equal(next.status, "loading");
  assert.deepEqual(effects, [
    { type: "loadWindow", request: next.request, grouping: "assignee" },
    { type: "showGrouping", grouping: "assignee" },
  ]);
});

test("picking the grouping already shown does nothing", () => {
  const [model] = init("epic");
  const [next, effects] = update(model, { type: "groupingPicked", grouping: "epic" });
  assert.equal(next, model);
  assert.deepEqual(effects, []);
});

test("a reply to an earlier request is dropped", () => {
  const [first] = init("epic");
  const second = run(first, { type: "groupingPicked", grouping: "stuck" });
  const late = run(second, {
    type: "windowLoaded",
    request: first.request,
    window: view("epic", ["a"]),
  });
  assert.equal(late, second);
  assert.equal(run(second, { type: "windowFailed", request: first.request }), second);
  const current = run(second, {
    type: "windowLoaded",
    request: second.request,
    window: view("stuck", ["idle"]),
  });
  assert.equal(current.window?.grouping, "stuck");
});

test("a failed load keeps the last window and can be retried", () => {
  const [model] = init("epic");
  const shown = run(model, {
    type: "windowLoaded",
    request: model.request,
    window: view("epic", ["a"]),
  });
  const failed = run(shown, { type: "retryClicked" }, { type: "windowFailed", request: 2 });
  assert.equal(failed.status, "failed");
  assert.equal(failed.window, shown.window);
  const [retried, effects] = update(failed, { type: "retryClicked" });
  assert.equal(retried.status, "loading");
  assert.deepEqual(effects, [{ type: "loadWindow", request: retried.request, grouping: "epic" }]);
});

test("toggling a cluster moves it between the two zoom levels", () => {
  const [model] = init("epic");
  const shown = run(model, {
    type: "windowLoaded",
    request: model.request,
    window: view("epic", ["a", "b"]),
  });
  assert.equal(zoomOf(shown, "a"), "cluster");
  const opened = run(shown, { type: "clusterToggled", key: "a" });
  assert.equal(zoomOf(opened, "a"), "list");
  assert.equal(zoomOf(opened, "b"), "cluster");
  const closed = run(opened, { type: "clusterToggled", key: "a" });
  assert.equal(zoomOf(closed, "a"), "cluster");
});

test("each grouping keeps its own open clusters", () => {
  const [model] = init("epic");
  const epic = run(
    model,
    { type: "windowLoaded", request: model.request, window: view("epic", ["a"]) },
    { type: "clusterToggled", key: "a" },
  );
  const stuck = run(epic, { type: "groupingPicked", grouping: "stuck" });
  const stuckShown = run(stuck, {
    type: "windowLoaded",
    request: stuck.request,
    window: view("stuck", ["a"]),
  });
  assert.equal(zoomOf(stuckShown, "a"), "cluster");
  const back = run(stuckShown, { type: "groupingPicked", grouping: "epic" });
  const epicShown = run(back, {
    type: "windowLoaded",
    request: back.request,
    window: view("epic", ["a"]),
  });
  assert.equal(zoomOf(epicShown, "a"), "list");
});

test("zoom acts on the window on screen while another grouping loads", () => {
  const [model] = init("epic");
  const loading = run(
    model,
    { type: "windowLoaded", request: model.request, window: view("epic", ["a"]) },
    { type: "groupingPicked", grouping: "assignee" },
    { type: "clusterToggled", key: "a" },
  );
  assert.deepEqual(loading.open.epic, ["a"]);
  assert.deepEqual(loading.open.assignee, []);
});

test("zoom does nothing before a window has loaded", () => {
  const [model] = init("epic");
  assert.equal(run(model, { type: "clusterToggled", key: "a" }), model);
});
