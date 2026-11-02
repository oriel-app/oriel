import assert from "node:assert/strict";
import { test } from "node:test";
import { donePage, workstreamThreads, nav, perPage } from "../src/nav.ts";
import { init, type Model, update } from "../src/root.ts";
import { parseRoute, routeUrl } from "../src/route.ts";
import type { ThreadSummaryView } from "../src/view.ts";
import { threadSummary, workstreamSummary, workstreamView } from "../testing.ts";

const workstreamA = "01JBZ0000000000000000000G1";
const workstreamB = "01JBZ0000000000000000000G2";

const thread = (
  n: number,
  state: ThreadSummaryView["state"] = "done",
  workstreamId = workstreamA,
): ThreadSummaryView =>
  threadSummary({
    id: `T${n}`,
    title: `Thread ${n}`,
    workstream: { id: workstreamId, name: workstreamId === workstreamA ? "Launch" : "Billing" },
    state,
    doneBy: state === "done" ? "marked" : null,
    waitingOn: null,
    // Thread 1 is the most recently active.
    activityAt: new Date(Date.UTC(2026, 9, 30) - n * 60_000).toISOString(),
  });

const many = (count: number) => Array.from({ length: count }, (_, i) => thread(i + 1));

test("the Done page shows 50 threads a page, with as many pages as that takes", () => {
  assert.equal(perPage, 50);
  for (const [count, pages] of [
    [0, 1],
    [1, 1],
    [50, 1],
    [51, 2],
    [100, 2],
    [101, 3],
  ] as const) {
    const first = donePage(many(count), 1);
    assert.equal(first.pages, pages, `${count} threads`);
    assert.equal(first.total, count);
    assert.equal(first.threads.length, Math.min(count, perPage));
  }
  // The last page holds what's left, and no thread shows on two pages.
  const done = many(101);
  const seen = [1, 2, 3].flatMap((n) => donePage(done, n).threads.map((each) => each.id));
  assert.equal(donePage(done, 3).threads.length, 1);
  assert.deepEqual(
    seen,
    done.map((each) => each.id),
  );
  assert.equal(donePage(done, 2).threads[0]?.id, "T51");
});

test("a page number past either end shows the nearest page", () => {
  const done = many(60);
  assert.equal(donePage(done, 0).number, 1);
  assert.equal(donePage(done, -3).number, 1);
  assert.equal(donePage(done, 9).number, 2);
  assert.equal(donePage(done, 9).threads.length, 10);
  assert.equal(donePage(done, Number.NaN).number, 1);
  assert.equal(donePage([], 4).number, 1);
});

test("Done holds every thread no longer working, most recently active first", () => {
  const model: Model = {
    ...init({ page: "done" })[0],
    threads: [
      thread(3),
      thread(1, "working"),
      thread(2),
      thread(4, "dropped"),
      thread(5, "handed-off"),
    ],
  };
  assert.deepEqual(
    nav(model).finished.map((each) => [each.id, each.state]),
    [
      ["T2", "done"],
      ["T3", "done"],
      ["T4", "dropped"],
      ["T5", "handed-off"],
    ],
  );
  // A working thread isn't among them: it's in Needs you, or under its workstream.
  assert.deepEqual(nav({ ...model, threads: null }).finished, []);
});

test("the Done page is at /done, with its page number past the first", () => {
  assert.equal(routeUrl({ page: "done" }), "/done");
  assert.equal(routeUrl({ page: "done", number: 1 }), "/done");
  assert.equal(routeUrl({ page: "done", number: 3 }), "/done?page=3");
  assert.deepEqual(parseRoute("/done", "?page=3"), { page: "done", number: 3 });
  assert.deepEqual(parseRoute("/done", ""), { page: "done" });
  // The inbox's old address is gone: it opens the window, as any unknown one does.
  assert.equal(parseRoute("/inbox", "").page, "window");
  // A page that isn't one is the first.
  for (const search of ["?page=1", "?page=0", "?page=-2", "?page=2.5", "?page=x"])
    assert.deepEqual(parseRoute("/done", search), { page: "done" }, search);
});

test("a workstream's page lists the threads the sidebar does, as they move", () => {
  const view = workstreamView({
    workstream: workstreamSummary({ id: workstreamA }),
    members: [],
    changes: [],
    threads: [thread(2, "working")],
  });
  const [entered] = init({ page: "workstream", id: workstreamA });
  const loaded = update(entered, {
    type: "replied",
    tag: { kind: "workstream", id: workstreamA },
    ok: true,
    body: view,
  })[0];
  // Before the threads list loads, the workstream's own.
  assert.deepEqual(
    workstreamThreads(loaded, workstreamA).map((each) => each.id),
    ["T2"],
  );
  // A new thread, and the one before it finishing, arrive in the list the
  // sidebar reloads when any thread moves; the workstream's page shows both.
  const [moved, reloads] = update(loaded, { type: "threadsMoved" });
  assert.ok(reloads.some((effect) => effect.type === "http" && effect.url === "/api/threads"));
  const [after] = update(moved, {
    type: "replied",
    tag: { kind: "threads" },
    ok: true,
    body: { threads: [thread(1, "working"), thread(2, "done"), thread(5, "working", workstreamB)] },
  });
  assert.deepEqual(
    workstreamThreads(after, workstreamA).map((each) => [each.id, each.state]),
    [
      ["T1", "working"],
      ["T2", "done"],
    ],
  );
});
