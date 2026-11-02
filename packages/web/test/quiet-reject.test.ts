// Reject is quieter than Approve (OA-90): one click, no reason field, and the
// message box waits for the answer; a rejected change set folds to one line
// until shown; and Oriel's line after it is Oriel's, never the agent's
// (OA-91).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Effect, Replied } from "../src/http.ts";
import {
  blocks,
  expected,
  folded,
  initThread,
  threadReplied,
  type ThreadModel,
  type ThreadMsg,
  updateThread,
} from "../src/thread.ts";
import type { ChangeSetView, ChatEntry } from "../src/view.ts";
import { changeSetView, diffView, threadView } from "../testing.ts";

const id = "01JBZ0000000000000000000T1";
const setId = "01JBZ0000000000000000000C1";
const revisedId = "01JBZ0000000000000000000C2";
const at = "2026-11-01T09:00:00.000Z";

const openSet = changeSetView({
  id: setId,
  status: "open",
  nextSteps: [{ kind: "approve" }, { kind: "reject" }],
  decision: null,
  revertOf: null,
});
const rejectedSet = changeSetView({
  ...openSet,
  status: "rejected",
  nextSteps: [],
  decision: { kind: "rejected", via: "thread", by: "you", at },
});

const replied = (tag: Replied["tag"], body: unknown, ok = true): Replied => ({
  type: "replied",
  tag,
  ok,
  body,
});

function loaded(changeSets: ChangeSetView[], entries: ChatEntry[] = []): ThreadModel {
  let [model] = initThread(id);
  const view = threadView({ id, entries, lastSeq: entries.at(-1)?.seq ?? 0, changeSets });
  [model] = threadReplied(model, replied({ kind: "thread", id }, view));
  for (const set of changeSets)
    [model] = threadReplied(
      model,
      replied({ kind: "diff", changeSetId: set.id }, diffView({ changeSetId: set.id, hash: "h" })),
    );
  return model;
}

const send = (model: ThreadModel, msg: ThreadMsg) => updateThread(model, msg);
const answered = (model: ThreadModel, ok: boolean): [ThreadModel, Effect[]] =>
  threadReplied(
    model,
    replied(
      { kind: "changeSet", threadId: id, changeSetId: setId },
      ok ? { changeSet: rejectedSet, problem: null } : { error: "The agent is still answering." },
      ok,
    ),
  );

test("Reject rejects in one click, folds the change set, and once it stands puts the cursor in the message box", () => {
  const [rejecting, effects] = send(loaded([openSet]), {
    type: "changeSetClicked",
    changeSetId: setId,
    step: "reject",
  });
  assert.deepEqual(
    effects.map((e) => (e.type === "http" ? [e.url, e.body] : e.type)),
    [[`/api/change-sets/${setId}/reject`, { hash: "h" }]],
  );
  // Shown rejected at once, so it folds at once; nothing runs on its own.
  const ahead = expected(rejecting);
  assert.equal(ahead?.running, false);
  const shownSet = ahead?.changeSets[0];
  assert.ok(shownSet && folded(rejecting, shownSet));
  assert.deepEqual(answered(rejecting, true)[1], [{ type: "focusComposer" }]);
  // Refused, it didn't stand: no focus, and the thread reloads.
  assert.ok(!answered(rejecting, false)[1].some((e) => e.type === "focusComposer"));
});

test("rejecting an Undo, which Oriel asks nothing about, leaves the cursor where it was", () => {
  const undo = { ...openSet, revertOf: revisedId };
  const [rejecting] = send(loaded([undo]), {
    type: "changeSetClicked",
    changeSetId: setId,
    step: "reject",
  });
  assert.deepEqual(answered(rejecting, true)[1], []);
});

test("a rejected change set is one line until shown, and folds again when hidden; others never fold", () => {
  const revised = { ...openSet, id: revisedId };
  const model = loaded([rejectedSet, revised]);
  assert.deepEqual([folded(model, rejectedSet), folded(model, revised)], [true, false]);
  const [shown] = send(model, { type: "foldToggled", changeSetId: setId });
  assert.equal(folded(shown, rejectedSet), false);
  const [hidden] = send(shown, { type: "foldToggled", changeSetId: setId });
  assert.equal(folded(hidden, rejectedSet), true);
  // The thread's address naming it opens it shown.
  const [named] = initThread(id, setId);
  assert.equal(folded(named, rejectedSet), false);
});

test("Oriel's line is a note of its own, never part of the agent's reply", () => {
  const entries: ChatEntry[] = [
    { seq: 1, at, kind: "user", text: "Rename it" },
    { seq: 2, at, kind: "text", text: "I proposed a new title." },
    { seq: 3, at, kind: "change-set", changeSetId: setId },
    { seq: 4, at, kind: "done" },
    { seq: 5, at, kind: "note", note: { kind: "rejected", changeSetId: setId, via: "thread" } },
  ];
  assert.deepEqual(
    blocks(entries).map((b) => (b.kind === "reply" ? b.text : b.kind)),
    ["user", "I proposed a new title.", "change-set", "note"],
  );
});
