// A held message, from anyone but the user, here a review link's holder: the
// user sends it to the agent as it is, edits it first, or discards it, and
// until then the thread waits on them, in Needs you.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Effect, Replied } from "../src/http.ts";
import { nav } from "../src/nav.ts";
import { init, type Model, update } from "../src/root.ts";
import {
  entriesOf,
  initThread,
  streamed,
  threadReplied,
  type ThreadModel,
  type ThreadMsg,
} from "../src/thread.ts";
import { type ChatEntry, holding, type ThreadView, waitingOn } from "../src/view.ts";
import { changeSetView, threadSummary, threadView } from "../testing.ts";

const id = "01JBZ0000000000000000000T1";
const workstreamId = "01JBZ0000000000000000000G1";
const setId = "01JBZ0000000000000000000C1";
const at = "2026-11-01T09:00:00.000Z";
// Where the held message is in the chat.
const seq = 3;

const rejectedSet = changeSetView({
  id: setId,
  status: "rejected",
  nextSteps: [],
  decision: { kind: "rejected", via: "review-link", by: "Ana", at },
});

const held = (outcome: "sent" | "discarded" | null): ChatEntry => ({
  seq,
  at,
  kind: "held",
  from: { kind: "review-link", by: "Ana", changeSetId: setId },
  text: "One story too many.",
  outcome,
});

const viewWith = (entry: ChatEntry, running = false): ThreadView =>
  threadView({
    id,
    title: "Plan gift cards",
    workstream: { id: workstreamId, name: "Practice", version: 1 },
    state: "working",
    entries: [{ seq: 1, at, kind: "change-set", changeSetId: setId }, entry],
    lastSeq: 3,
    running,
    changeSets: [rejectedSet],
  });

const summary = threadSummary({
  id,
  title: "Plan gift cards",
  workstream: { id: workstreamId, name: "Practice" },
  state: "working",
  waitingOn: "held",
});

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
  const [, block] = entriesOf(viewWith(held(null)).entries);
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

test("Edit moves the words into the composer, and Send there posts what the user made of them", () => {
  let [model] = send(onPage(), { type: "draftChanged", text: "Half a thought" });
  let effects: Effect[];
  [model, effects] = send(model, { type: "heldEditClicked", seq });
  // The composer holds the message's words, and has the focus.
  assert.equal(thread(model).draft, "One story too many.");
  assert.deepEqual(effects, [{ type: "focusComposer" }]);
  [model] = send(model, { type: "draftChanged", text: "  Drop the third story. " });
  // The composer's Send sends it as the held message, edited, not as a new one.
  const [sent, posts] = send(model, { type: "sendClicked" });
  assert.deepEqual(posts, [posted("send", { text: "Drop the third story." })]);
  // So does the card's own Send to agent.
  assert.deepEqual(send(model, { type: "heldSendClicked", seq })[1], posts);
  const [done] = update(sent, replied(tag, { seq: 4 }));
  assert.equal(thread(done).draft, "");
  assert.equal(thread(done).composing, null);
});

test("sent from the composer, the words leave it even when the thread reloads first", () => {
  let [model] = send(onPage(), { type: "heldEditClicked", seq });
  [model] = send(model, { type: "draftChanged", text: "Drop the third story." });
  [model] = send(model, { type: "sendClicked" });
  // The thread's stream says it's sent before the send itself answers.
  [model] = update(model, replied({ kind: "thread", id }, viewWith(held("sent"))));
  [model] = update(model, replied(tag, { seq: 4 }));
  assert.equal(thread(model).draft, "");
  assert.equal(thread(model).composing, null);
});

test("an edit emptied out sends nothing; Cancel puts back what the composer held", () => {
  let [model] = send(onPage(), { type: "draftChanged", text: "Half a thought" });
  [model] = send(model, { type: "heldEditClicked", seq });
  [model] = send(model, { type: "draftChanged", text: "   " });
  assert.deepEqual(send(model, { type: "sendClicked" })[1], []);
  assert.deepEqual(send(model, { type: "heldSendClicked", seq })[1], []);
  [model] = send(model, { type: "heldEditCancelled", seq });
  assert.equal(thread(model).draft, "Half a thought");
  assert.equal(thread(model).composing, null);
  // Sent as it is, then, and the composer keeps the user's own words.
  assert.deepEqual(send(model, { type: "heldSendClicked", seq })[1], [posted("send", {})]);
  const [sent] = send(model, { type: "heldSendClicked", seq });
  assert.equal(thread(update(sent, replied(tag, { seq: 4 }))[0]).draft, "Half a thought");
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

test("an edit of a message another page sent stays in the composer as the user's own words", () => {
  const [editing] = send(onPage(), { type: "heldEditClicked", seq });
  assert.equal(thread(editing).composing?.seq, seq);
  // Still held, the edit stays one of it.
  const [kept] = update(editing, replied({ kind: "thread", id }, viewWith(held(null))));
  assert.equal(thread(kept).composing?.seq, seq);
  const [reloaded] = update(editing, replied({ kind: "thread", id }, viewWith(held("sent"))));
  assert.equal(thread(reloaded).composing, null);
  assert.equal(thread(reloaded).draft, "One story too many.");
  // Send now sends a message of the user's own.
  const [, effects] = send(reloaded, { type: "sendClicked" });
  assert.equal((effects[0] as { url?: string }).url, `/api/threads/${id}/messages`);
});

test("a held message settled on another page reloads this one, and only the thread", () => {
  const model = onPage();
  assert.deepEqual(streamed(thread(model), { type: "chat" })[1], [reload]);
  // The workspace's own event, right after, loads the lists; this one doesn't.
  const [, effects] = update(model, { type: "streamed", event: { type: "chat" } });
  assert.deepEqual(effects, [reload]);
});
