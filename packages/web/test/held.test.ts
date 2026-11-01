// A held message, from anyone but the user, here a review link's holder: the
// user sends it to the agent as it is, edits it first, or discards it, and
// until then the thread waits on them, in Needs you.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Effect, Replied } from "../src/http.ts";
import { nav } from "../src/nav.ts";
import { init, type Model, update } from "../src/root.ts";
import {
  blocks,
  initThread,
  streamed,
  threadReplied,
  type ThreadModel,
  type ThreadMsg,
} from "../src/thread.ts";
import {
  type ChangeSetView,
  type ChatEntry,
  holding,
  type ThreadSummaryView,
  type ThreadView,
  waitingOn,
} from "../src/view.ts";

const id = "01JBZ0000000000000000000T1";
const groupId = "01JBZ0000000000000000000G1";
const setId = "01JBZ0000000000000000000C1";
const at = "2026-11-01T09:00:00.000Z";
// Where the held message is in the chat.
const seq = 3;

const rejectedSet: ChangeSetView = {
  id: setId,
  status: "rejected",
  nextSteps: [],
  applying: false,
  sentUnapplied: false,
  decision: { kind: "rejected", via: "review-link", by: "Ana", at },
  errors: [],
  revertOf: null,
  reverts: [],
  createdAt: at,
};

const held = (outcome: "sent" | "discarded" | null): ChatEntry => ({
  seq,
  at,
  kind: "held",
  from: { kind: "review-link", by: "Ana", changeSetId: setId },
  text: "One story too many.",
  outcome,
});

const viewWith = (entry: ChatEntry, running = false): ThreadView => ({
  id,
  title: "Plan gift cards",
  group: { id: groupId, name: "Practice", version: 1 },
  state: "working",
  doneBy: null,
  regionVersion: 1,
  members: [],
  entries: [{ seq: 1, at, kind: "change-set", changeSetId: setId }, entry],
  lastSeq: 3,
  running,
  changeSets: [rejectedSet],
  writable: true,
});

const summary: ThreadSummaryView = {
  id,
  title: "Plan gift cards",
  group: { id: groupId, name: "Practice" },
  state: "working",
  doneBy: null,
  waitingOn: "held",
  activityAt: at,
};

const replied = (tag: Replied["tag"], body: unknown, ok = true): Replied => ({
  type: "replied",
  tag,
  ok,
  body,
});

function onPage(view = viewWith(held(null))): Model {
  let [thread] = initThread(id);
  [thread] = threadReplied(thread, replied({ kind: "thread", id }, view));
  return { ...init({ page: "thread", id })[0], thread, threads: [summary] };
}

const send = (model: Model, msg: ThreadMsg): [Model, Effect[]] =>
  update(model, { type: "thread", msg });
const thread = (model: Model) => model.thread as ThreadModel;
const tag = { kind: "held", threadId: id, seq } as const;
const posted = (action: "send" | "discard", body: unknown): Effect => ({
  type: "http",
  method: "POST",
  url: `/api/threads/${id}/held/${seq}/${action}`,
  body,
  tag,
});
const reload: Effect = {
  type: "http",
  method: "GET",
  url: `/api/threads/${id}`,
  tag: { kind: "thread", id },
};

test("a held message is a block of its own, under who it is from", () => {
  const [, block] = blocks(viewWith(held(null)).entries);
  assert.deepEqual(block, {
    seq,
    at,
    kind: "held",
    from: { kind: "review-link", by: "Ana", changeSetId: setId },
    text: "One story too many.",
    outcome: null,
  });
});

test("while a message is held the thread waits on the user, in Needs you; once settled, it doesn't", () => {
  const working = { state: "working" as const, running: false, changeSets: [rejectedSet] };
  assert.equal(holding(viewWith(held(null)).entries), true);
  assert.equal(holding(viewWith(held("sent")).entries), false);
  assert.equal(holding(viewWith(held("discarded")).entries), false);
  assert.equal(waitingOn({ ...working, held: true }), "held");
  assert.equal(waitingOn({ ...working, held: false }), "reply");
  // The agent mid-turn comes first; a settled thread waits on nothing.
  assert.equal(waitingOn({ ...working, running: true, held: true }), "agent");
  assert.equal(waitingOn({ ...working, state: "done", held: true }), null);
  const model = onPage();
  assert.deepEqual(
    nav(model).waiting.map((each) => each.waitingOn),
    ["held"],
  );
  assert.equal(nav(model).needsYou, 1);
});

test("Send posts the message as it is, and the reply reloads the thread", () => {
  const [sending, effects] = send(onPage(), { type: "heldSendClicked", seq });
  assert.deepEqual(effects, [posted("send", {})]);
  assert.deepEqual(thread(sending).settling, [seq]);
  // A second click while it's on its way does nothing.
  assert.deepEqual(send(sending, { type: "heldSendClicked", seq })[1], []);
  const [done, after] = update(sending, replied(tag, { seq: 4 }));
  assert.deepEqual(thread(done).settling, []);
  assert.deepEqual(after, [reload]);
});

test("Edit starts from the message, and Send posts what the user made of it", () => {
  let [model] = send(onPage(), { type: "heldEditClicked", seq });
  assert.equal(thread(model).editing[seq], "One story too many.");
  [model] = send(model, {
    type: "heldEdited",
    seq,
    text: "  Drop the third story. ",
  });
  const [sent, effects] = send(model, { type: "heldSendClicked", seq });
  assert.deepEqual(effects, [posted("send", { text: "Drop the third story." })]);
  const [done] = update(sent, replied(tag, { seq: 4 }));
  assert.deepEqual(thread(done).editing, {});
});

test("an edit emptied out sends nothing; Cancel goes back to the message as it was", () => {
  let [model] = send(onPage(), { type: "heldEditClicked", seq });
  [model] = send(model, { type: "heldEdited", seq, text: "   " });
  assert.deepEqual(send(model, { type: "heldSendClicked", seq })[1], []);
  [model] = send(model, { type: "heldEditCancelled", seq });
  assert.deepEqual(thread(model).editing, {});
  assert.deepEqual(send(model, { type: "heldSendClicked", seq })[1], [posted("send", {})]);
});

test("Send waits for the agent to finish; Discard doesn't", () => {
  const model = onPage(viewWith(held(null), true));
  assert.deepEqual(send(model, { type: "heldSendClicked", seq })[1], []);
  assert.deepEqual(send(model, { type: "heldDiscardClicked", seq })[1], [posted("discard", {})]);
});

test("a refusal says why, and a message already settled offers nothing", () => {
  const [sending] = send(onPage(), { type: "heldSendClicked", seq });
  const [refused, effects] = update(
    sending,
    replied(tag, { error: "That message was already sent or discarded." }, false),
  );
  assert.equal(thread(refused).notice, "That message was already sent or discarded.");
  assert.deepEqual(effects, [reload]);
  const settled = onPage(viewWith(held("discarded")));
  for (const type of ["heldSendClicked", "heldDiscardClicked", "heldEditClicked"] as const)
    assert.deepEqual(send(settled, { type, seq }), [settled, []]);
});

test("an edit of a message another page sent is dropped when the thread reloads", () => {
  const [editing] = send(onPage(), { type: "heldEditClicked", seq });
  assert.ok(seq in thread(editing).editing);
  const [reloaded] = update(editing, replied({ kind: "thread", id }, viewWith(held("sent"))));
  assert.deepEqual(thread(reloaded).editing, {});
  // Still held, the edit stays.
  const [kept] = update(editing, replied({ kind: "thread", id }, viewWith(held(null))));
  assert.ok(seq in thread(kept).editing);
});

test("a held message settled on another page reloads this one, and only the thread", () => {
  const model = onPage();
  assert.deepEqual(streamed(thread(model), { type: "chat" })[1], [reload]);
  // The workspace's own event, right after, loads the lists; this one doesn't.
  const [, effects] = update(model, { type: "streamed", event: { type: "chat" } });
  assert.deepEqual(effects, [reload]);
});
