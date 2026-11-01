import assert from "node:assert/strict";
import { test } from "node:test";
import { doneShown, perPage } from "../src/nav.ts";
import { routeUrl } from "../src/route.ts";
import type { ThreadSummaryView } from "../src/view.ts";

const thread = (n: number, state: ThreadSummaryView["state"]): ThreadSummaryView => ({
  id: `T${n}`,
  title: `Thread ${n}`,
  group: { id: "01JBZ0000000000000000000G1", name: "Launch" },
  state,
  doneBy: state === "done" ? "marked" : null,
  waitingOn: null,
  activityAt: new Date(Date.UTC(2026, 9, 30) - n * 60_000).toISOString(),
});

// Finished threads, newest first: done and handed-off ones, then dropped.
const finished = [
  ...Array.from({ length: perPage + 2 }, (_, i) => thread(i + 1, i === 0 ? "handed-off" : "done")),
  ...Array.from({ length: perPage * 2 + 1 }, (_, i) => thread(perPage + 3 + i, "dropped")),
];

test("the Done page's tab picks its list; both tabs count theirs", () => {
  const done = doneShown(finished, {});
  assert.deepEqual(done.counts, { done: perPage + 2, dropped: perPage * 2 + 1 });
  assert.ok(done.page.threads.every((each) => each.state !== "dropped"));
  assert.equal(done.page.threads[0]?.state, "handed-off");
  const dropped = doneShown(finished, { tab: "dropped" });
  assert.deepEqual(dropped.counts, done.counts);
  assert.ok(dropped.page.threads.every((each) => each.state === "dropped"));
  assert.equal(dropped.page.pages, 3);
});

test("Previous and Next keep the tab, and only go where there is a page", () => {
  const first = doneShown(finished, { tab: "dropped" });
  assert.equal(first.previous, null);
  assert.deepEqual(first.next, { page: "done", tab: "dropped", number: 2 });
  const second = doneShown(finished, { tab: "dropped", number: 2 });
  assert.deepEqual(
    [second.previous, second.next].map((route) => route && routeUrl(route)),
    ["/done?tab=dropped", "/done?tab=dropped&page=3"],
  );
  assert.equal(doneShown(finished, { tab: "dropped", number: 3 }).next, null);
  // The Done tab's own pages carry no tab.
  const done = doneShown(finished, { number: 2 });
  assert.deepEqual(done.previous, { page: "done" });
  assert.equal(done.next, null);
  // Past the end, the last page, which still leads back.
  const past = doneShown(finished, { tab: "dropped", number: 9 });
  assert.equal(past.page.number, 3);
  assert.deepEqual(past.previous, { page: "done", tab: "dropped", number: 2 });
});
