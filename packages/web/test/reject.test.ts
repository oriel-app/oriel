// Reject is one click; a review link's holder may give a reason with it.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Effect, Replied } from "../src/http.ts";
import { nav } from "../src/nav.ts";
import { initReview, reviewReplied, updateReview } from "../src/review.ts";
import { init, type Model, update } from "../src/root.ts";
import {
  expected,
  initThread,
  threadReplied,
  type ThreadModel,
  type ThreadMsg,
} from "../src/thread.ts";
import { changeSetView, diffView, threadSummary, threadView } from "../testing.ts";

const id = "01JBZ0000000000000000000T1";
const workstreamId = "01JBZ0000000000000000000G1";
const setId = "01JBZ0000000000000000000C1";

const openSet = changeSetView({
  id: setId,
  status: "open",
  nextSteps: [{ kind: "approve" }, { kind: "reject" }],
  decision: null,
});

const view = threadView({
  id,
  title: "Rename the practice story",
  workstream: { id: workstreamId, name: "Practice", version: 1 },
  state: "working",
  entries: [],
  running: false,
  changeSets: [openSet],
  writable: true,
});

const summary = threadSummary({
  id,
  title: "Rename the practice story",
  workstream: { id: workstreamId, name: "Practice" },
  state: "working",
  waitingOn: "review",
});

const replied = (tag: Replied["tag"], body: unknown, ok = true): Replied => ({
  type: "replied",
  tag,
  ok,
  body,
});

// The thread's page with its change set loaded and diffed, and the sidebar.
function onPage(): Model {
  let [thread] = initThread(id);
  [thread] = threadReplied(thread, replied({ kind: "thread", id }, view));
  [thread] = threadReplied(
    thread,
    replied({ kind: "diff", changeSetId: setId }, diffView({ changeSetId: setId, hash: "h" })),
  );
  return { ...init({ page: "thread", id })[0], thread, threads: [summary] };
}

const send = (model: Model, msg: ThreadMsg): [Model, Effect[]] =>
  update(model, { type: "thread", msg });
const reject = (model: Model) =>
  send(model, { type: "changeSetClicked", changeSetId: setId, step: "reject" });
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
});

test("a review link sends a reason with a rejection only", () => {
  const [opening] = updateReview(initReview("tok")[0], { type: "openClicked" });
  const [shown] = reviewReplied(
    opening,
    replied(
      { kind: "reviewOpened" },
      { changeSet: openSet, diff: diffView({ changeSetId: setId, hash: "h1" }) },
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
