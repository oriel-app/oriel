// A workstream's threads are listed by the label each row shows (OA-147):
// what waits on the user (Needs review, Message held, Your turn), then what
// is running (Agent working, Applying…), then Handed off, Done and Dropped;
// within a label, newest activity first, by the time the row shows. The
// workstream's page and the sidebar read the one order, and a thread that
// changes state moves to its new label's place.
import assert from "node:assert/strict";
import { test } from "node:test";
import { byLabel, nav, workstreamThreads } from "../src/nav.ts";
import { init, type Model, update } from "../src/root.ts";
import type { ThreadStateId, ThreadSummaryView, WaitingOn } from "../src/view.ts";
import { threadSummary, workstreamSummary } from "../testing.ts";

const workstreamId = "01JBZ0000000000000000000G1";

// `minutes` after 10:00 on Nov 1, so a larger number is newer.
const thread = (
  id: string,
  state: ThreadStateId,
  waitingOn: WaitingOn | null,
  minutes: number,
): ThreadSummaryView =>
  threadSummary({
    id,
    title: id,
    workstream: { id: workstreamId, name: "Launch" },
    state,
    doneBy: state === "done" ? "marked" : null,
    waitingOn,
    activityAt: new Date(Date.UTC(2026, 10, 1, 10, minutes)).toISOString(),
  });

// One thread in every state, and two Done ones, listed newest first, as the
// server sends them: the one that waits on the user is near the bottom.
const every = [
  thread("done-late", "done", null, 59),
  thread("agent", "working", "agent", 50),
  thread("dropped", "dropped", null, 45),
  thread("handed-off", "handed-off", null, 40),
  thread("apply", "working", "apply", 35),
  thread("held", "working", "held", 30),
  thread("done-early", "done", null, 20),
  thread("review", "working", "review", 10),
  thread("reply", "working", "reply", 5),
];

const ids = (threads: readonly ThreadSummaryView[]) => threads.map((each) => each.id);

const loaded = (threads: ThreadSummaryView[]): Model => {
  const [entered] = init({ page: "workstream", id: workstreamId });
  const [listed] = update(entered, {
    type: "replied",
    tag: { kind: "threads" },
    ok: true,
    body: { threads },
  });
  return update(listed, {
    type: "replied",
    tag: { kind: "workstreams" },
    ok: true,
    body: { workstreams: [workstreamSummary({ id: workstreamId, name: "Launch" })] },
  })[0];
};

test("a workstream's threads go by label, what waits on the user first, then newest first", () => {
  assert.deepEqual(ids(every.toSorted(byLabel)), [
    "review",
    "held",
    "reply",
    "agent",
    "apply",
    "handed-off",
    "done-late",
    "done-early",
    "dropped",
  ]);
});

test("a thread that waits on the user is above every Done one, however old", () => {
  const sorted = ids(every.toSorted(byLabel));
  const lastWaiting = Math.max(...["review", "held", "reply"].map((id) => sorted.indexOf(id)));
  const firstDone = Math.min(sorted.indexOf("done-late"), sorted.indexOf("done-early"));
  assert.ok(lastWaiting < firstDone);
});

test("within a label, the newest activity comes first", () => {
  const replies = [
    thread("older", "working", "reply", 1),
    thread("newer", "working", "reply", 40),
    thread("newest", "working", "reply", 41),
  ];
  assert.deepEqual(ids(replies.toSorted(byLabel)), ["newest", "newer", "older"]);
});

test("the workstream's page and the sidebar list its threads in the one order", () => {
  const model = loaded(every);
  const page = ids(workstreamThreads(model, workstreamId));
  assert.deepEqual(page, ids(every.toSorted(byLabel)));
  assert.deepEqual(ids(nav(model).workstreams?.[0]?.threads ?? []), page);
});

test("a thread that changes state moves to its new label's place at once", () => {
  const before = loaded(every);
  assert.equal(ids(workstreamThreads(before, workstreamId)).at(-3), "done-late");
  // The agent finished: the thread is the user's turn now, and newest.
  const after = loaded(
    every.map((each) =>
      each.id === "done-late" ? thread("done-late", "working", "reply", 59) : each,
    ),
  );
  assert.deepEqual(ids(workstreamThreads(after, workstreamId)).slice(0, 4), [
    "review",
    "held",
    "done-late",
    "reply",
  ]);
});

test("before the threads list loads, the workstream's own threads go in the same order", () => {
  const [entered] = init({ page: "workstream", id: workstreamId });
  const [shown] = update(entered, {
    type: "replied",
    tag: { kind: "workstream", id: workstreamId },
    ok: true,
    body: {
      workstream: workstreamSummary({ id: workstreamId }),
      members: [],
      changes: [],
      threads: every,
    },
  });
  assert.deepEqual(ids(workstreamThreads(shown, workstreamId)), ids(every.toSorted(byLabel)));
});
