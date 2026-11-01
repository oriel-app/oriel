// Rejecting with a reason: the reason goes with the rejection, and the thread
// shows the agent answering it at once; with none, Reject is one click.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Effect, Replied } from "../src/http.ts";
import { nav } from "../src/nav.ts";
import { initReview, reviewReplied, updateReview } from "../src/review.ts";
import { init, type Model, update } from "../src/root.ts";
import {
  blocks,
  expected,
  initThread,
  threadReplied,
  type ThreadModel,
  type ThreadMsg,
} from "../src/thread.ts";
import type { ChangeSetView, ChatEntry, ThreadSummaryView, ThreadView } from "../src/view.ts";

const id = "01JBZ0000000000000000000T1";
const groupId = "01JBZ0000000000000000000G1";
const setId = "01JBZ0000000000000000000C1";
const at = "2026-10-31T09:00:00.000Z";

const openSet: ChangeSetView = {
  id: setId,
  status: "open",
  nextSteps: [{ kind: "approve" }, { kind: "reject" }],
  applying: false,
  sentUnapplied: false,
  decision: null,
  errors: [],
  revertOf: null,
  reverts: [],
  createdAt: at,
};

const threadView: ThreadView = {
  id,
  title: "Rename the practice story",
  group: { id: groupId, name: "Practice", version: 1 },
  state: "working",
  doneBy: null,
  regionVersion: 1,
  members: [],
  entries: [],
  lastSeq: 0,
  running: false,
  changeSets: [openSet],
  writable: true,
};

const summary: ThreadSummaryView = {
  id,
  title: "Rename the practice story",
  group: { id: groupId, name: "Practice" },
  state: "working",
  doneBy: null,
  waitingOn: "review",
  activityAt: at,
};

const replied = (tag: Replied["tag"], body: unknown, ok = true): Replied => ({
  type: "replied",
  tag,
  ok,
  body,
});

// The thread's page with its change set loaded and diffed, and the sidebar.
function onPage(): Model {
  let [thread] = initThread(id);
  [thread] = threadReplied(thread, replied({ kind: "thread", id }, threadView));
  [thread] = threadReplied(
    thread,
    replied({ kind: "diff", changeSetId: setId }, { changeSetId: setId, hash: "h", lines: [] }),
  );
  return { ...init({ page: "thread", id })[0], thread, threads: [summary] };
}

const send = (model: Model, msg: ThreadMsg): [Model, Effect[]] =>
  update(model, { type: "thread", msg });
const typed = (model: Model, text: string) =>
  send(model, { type: "reasonChanged", changeSetId: setId, text })[0];
const reject = (model: Model) =>
  send(model, { type: "changeSetClicked", changeSetId: setId, step: "reject" });
const answered = (model: Model, body: unknown, ok = true) =>
  update(model, replied({ kind: "changeSet", threadId: id, changeSetId: setId }, body, ok))[0];
const thread = (model: Model) => model.thread as ThreadModel;
// What Needs you says the thread waits on, or null when it isn't there.
const needsYou = (model: Model) =>
  nav(model).waiting.find((each) => each.id === id)?.waitingOn ?? null;
const posted = (body: unknown): Effect => ({
  type: "http",
  method: "POST",
  url: `/api/change-sets/${setId}/reject`,
  body,
  tag: { kind: "changeSet", threadId: id, changeSetId: setId },
});

test("Reject with nothing typed is one click, and leaves the thread for the user's reply", () => {
  const [rejecting, effects] = reject(onPage());
  assert.deepEqual(effects, [posted({ hash: "h" })]);
  assert.equal(expected(thread(rejecting))?.running, false);
  assert.equal(needsYou(rejecting), "reply");
  // Blank isn't a reason.
  assert.deepEqual(reject(typed(onPage(), "   "))[1], [posted({ hash: "h" })]);
});

test("a reason goes with Reject, and the thread shows the agent answering it at once", () => {
  const [rejecting, effects] = reject(typed(onPage(), "  Title should be “Practice: reject you” "));
  assert.deepEqual(effects, [
    posted({ hash: "h", reason: "Title should be “Practice: reject you”" }),
  ]);
  const ahead = expected(thread(rejecting));
  assert.deepEqual(
    [ahead?.running, ahead?.changeSets[0]?.status, ahead?.changeSets[0]?.nextSteps],
    [true, "rejected", []],
  );
  // Out of Needs you while the agent answers.
  assert.equal(needsYou(rejecting), null);
  // Answered: the reason is said, and its field is cleared.
  const done = answered(rejecting, {
    changeSet: { ...openSet, status: "rejected", nextSteps: [] },
    problem: null,
  });
  assert.deepEqual(thread(done).reasons, {});
  assert.equal(thread(done).draft, "");
});

test("a reason that couldn't be said waits in the message box; a refused rejection keeps it", () => {
  const rejecting = reject(typed(onPage(), "Wrong title."))[0];
  const capped = answered(rejecting, {
    changeSet: { ...openSet, status: "rejected", nextSteps: [] },
    problem: "This thread has had all 30 of its questions.",
  });
  assert.equal(thread(capped).draft, "Wrong title.");
  assert.equal(thread(capped).problems[setId], "This thread has had all 30 of its questions.");
  // Something typed already stays.
  const drafted = send(rejecting, { type: "draftChanged", text: "Mine" })[0];
  assert.equal(thread(answered(drafted, { problem: "No." })).draft, "Mine");
  // Refused, nothing was decided: the reason stays with Reject.
  const refused = answered(rejecting, { error: "The agent is still answering." }, false);
  assert.deepEqual(thread(refused).reasons, { [setId]: "Wrong title." });
  assert.equal(thread(refused).draft, "");
});

test("Oriel's line after a turn ended is a reply of its own", () => {
  const entries: ChatEntry[] = [
    { seq: 1, at, kind: "user", text: "Rename it" },
    { seq: 2, at, kind: "text", text: "I proposed " },
    { seq: 3, at, kind: "text", text: "a new title." },
    { seq: 4, at, kind: "done" },
    { seq: 5, at, kind: "text", text: "You rejected this change set." },
    { seq: 6, at, kind: "done" },
    { seq: 7, at, kind: "text", text: "You rejected that one too." },
  ];
  assert.deepEqual(
    blocks(entries).map((b) => (b.kind === "reply" ? b.text : b.kind)),
    [
      "user",
      "I proposed a new title.",
      "You rejected this change set.",
      "You rejected that one too.",
    ],
  );
});

test("a review link sends a reason with a rejection only", () => {
  const [opening] = updateReview(initReview("tok")[0], { type: "openClicked" });
  const [shown] = reviewReplied(
    opening,
    replied(
      { kind: "reviewOpened" },
      { changeSet: openSet, diff: { changeSetId: setId, hash: "h1", lines: [] } },
    ),
  );
  let model = updateReview(shown, { type: "nameChanged", name: "Ana" })[0];
  model = updateReview(model, { type: "reasonChanged", reason: " One story too many. " })[0];
  const body = (kind: "approved" | "rejected") => {
    const [effect] = updateReview(model, { type: "decideClicked", kind })[1];
    return effect?.type === "http" ? effect.body : null;
  };
  assert.deepEqual(body("rejected"), {
    token: "tok",
    changeSet: setId,
    kind: "rejected",
    name: "Ana",
    hash: "h1",
    reason: "One story too many.",
  });
  assert.deepEqual(body("approved"), {
    token: "tok",
    changeSet: setId,
    kind: "approved",
    name: "Ana",
    hash: "h1",
  });
});
