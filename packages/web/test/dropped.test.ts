import assert from "node:assert/strict";
import { test } from "node:test";
import { doneTabs, donePage, nav, perPage } from "../src/nav.ts";
import { init, type Model } from "../src/root.ts";
import { parseRoute, type Route, routeUrl } from "../src/route.ts";
import type { ThreadSummaryView } from "../src/view.ts";

const thread = (n: number, state: ThreadSummaryView["state"]): ThreadSummaryView => ({
  id: `T${n}`,
  title: `Thread ${n}`,
  workstream: { id: "01JBZ0000000000000000000G1", name: "Launch" },
  state,
  doneBy: state === "done" ? "marked" : null,
  waitingOn: null,
  // Thread 1 is the most recently active.
  activityAt: new Date(Date.UTC(2026, 9, 30) - n * 60_000).toISOString(),
});

test("the Done tab holds done and handed-off threads, and the Dropped tab dropped ones", () => {
  const model: Model = {
    ...init({ page: "done", tab: "dropped" })[0],
    threads: [
      thread(4, "dropped"),
      thread(1, "working"),
      thread(3, "handed-off"),
      thread(2, "done"),
      thread(5, "dropped"),
    ],
  };
  const tabs = doneTabs(nav(model).finished);
  // Each most recently active first; a working thread is in neither.
  assert.deepEqual(
    tabs.done.map((each) => each.id),
    ["T2", "T3"],
  );
  assert.deepEqual(
    tabs.dropped.map((each) => each.id),
    ["T4", "T5"],
  );
  assert.deepEqual(doneTabs([]), { done: [], dropped: [] });
});

test("the Dropped tab pages 50 at a time, apart from the Done tab", () => {
  const finished = [
    ...Array.from({ length: perPage + 1 }, (_, i) => thread(i + 1, "dropped")),
    ...Array.from({ length: 3 }, (_, i) => thread(perPage + 2 + i, "done")),
  ];
  const { done, dropped } = doneTabs(finished);
  const [first, second] = [donePage(dropped, 1), donePage(dropped, 2)];
  assert.deepEqual([first.pages, first.total, first.threads.length], [2, perPage + 1, perPage]);
  assert.deepEqual(
    second.threads.map((each) => each.id),
    [`T${perPage + 1}`],
  );
  assert.deepEqual([donePage(done, 1).pages, donePage(done, 1).total], [1, 3]);
});

test("the Dropped tab has an address of its own, with its page past the first", () => {
  const cases: [Route, string][] = [
    [{ page: "done", tab: "dropped" }, "/done?tab=dropped"],
    [{ page: "done", tab: "dropped", number: 2 }, "/done?tab=dropped&page=2"],
    [{ page: "done", number: 2 }, "/done?page=2"],
  ];
  for (const [route, url] of cases) {
    assert.equal(routeUrl(route), url);
    const at = new URL(url, "http://localhost");
    assert.deepEqual(parseRoute(at.pathname, at.search), route, url);
  }
  assert.equal(routeUrl({ page: "done", tab: "dropped", number: 1 }), "/done?tab=dropped");
  assert.deepEqual(parseRoute("/done", "?page=2&tab=dropped"), {
    page: "done",
    tab: "dropped",
    number: 2,
  });
  // A tab that isn't one is the Done tab.
  for (const search of ["?tab=done", "?tab=Dropped", "?tab="])
    assert.deepEqual(parseRoute("/done", search), { page: "done" }, search);
});
