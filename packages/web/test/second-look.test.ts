// Second look is the person's to press (decision 0054): it asks once, waits
// on its own, and leaves Approve and Reject as they were.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Effect, Replied } from "../src/http.ts";
import {
  initThread,
  threadReplied,
  type ThreadModel,
  type ThreadMsg,
  updateThread,
} from "../src/thread.ts";
import { changeSetView, diffView, threadView } from "../testing.ts";

const id = "01JBZ0000000000000000000T1";
const setId = "01JBZ0000000000000000000C1";

const openSet = changeSetView({
  id: setId,
  status: "open",
  nextSteps: [{ kind: "approve" }, { kind: "reject" }],
  decision: null,
  revertOf: null,
  secondLook: null,
});

const replied = (tag: Replied["tag"], body: unknown, ok = true): Replied => ({
  type: "replied",
  tag,
  ok,
  body,
});

function loaded(): ThreadModel {
  let [model] = initThread(id);
  const view = threadView({ id, entries: [], lastSeq: 0, changeSets: [openSet] });
  [model] = threadReplied(model, replied({ kind: "thread", id }, view));
  [model] = threadReplied(
    model,
    replied({ kind: "diff", changeSetId: setId }, diffView({ changeSetId: setId, hash: "h" })),
  );
  return model;
}

const send = (model: ThreadModel, msg: ThreadMsg) => updateThread(model, msg);
const urls = (effects: Effect[]) => effects.map((e) => (e.type === "http" ? e.url : e.type));

test("Second look asks once, and Approve stays usable while it waits", () => {
  const [looking, effects] = send(loaded(), { type: "secondLookClicked", changeSetId: setId });
  assert.deepEqual(urls(effects), [`/api/change-sets/${setId}/second-look`]);
  assert.deepEqual(looking.looking, [setId]);
  assert.deepEqual(looking.busy, [], "the change set itself isn't busy");
  // A second press while the first is in flight asks nothing.
  assert.deepEqual(send(looking, { type: "secondLookClicked", changeSetId: setId })[1], []);
  // Approve goes ahead meanwhile.
  const [, approving] = send(looking, {
    type: "changeSetClicked",
    changeSetId: setId,
    step: "approve",
  });
  assert.deepEqual(urls(approving), [`/api/change-sets/${setId}/approve`]);
});

test("answered, the button waits on the thread's stream; refused, it says why", () => {
  const [looking] = send(loaded(), { type: "secondLookClicked", changeSetId: setId });
  const tag = { kind: "secondLook", threadId: id, changeSetId: setId } as const;
  const [started, none] = threadReplied(looking, replied(tag, { changeSet: openSet }));
  assert.deepEqual(started.looking, []);
  assert.deepEqual(none, []);
  const [refused, reload] = threadReplied(
    looking,
    replied(tag, { error: "second looks are off here" }, false),
  );
  assert.deepEqual(refused.looking, []);
  assert.equal(refused.problems[setId], "second looks are off here");
  assert.deepEqual(urls(reload), [`/api/threads/${id}`]);
});
