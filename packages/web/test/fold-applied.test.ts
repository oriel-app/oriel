// An applied change set folds to one line, its Revert a click away; one
// applied while the page is open folds itself after a beat, unless it
// applied with errors, stalled, was shown or hidden by hand, or is named by
// the page's address; and an Undo still waiting on the person keeps the set
// it reverts shown.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Effect, Replied } from "../src/http.ts";
import {
  closeMs,
  folded,
  landMs,
  initThread,
  threadReplied,
  type ThreadModel,
  updateThread,
} from "../src/thread.ts";
import type { ChangeSetView } from "../src/view.ts";
import { changeSetView, threadView } from "../testing.ts";

const id = "01JBZ0000000000000000000T1";
const setId = "01JBZ0000000000000000000C1";
const undoId = "01JBZ0000000000000000000C2";
const at = "2026-11-01T09:00:00.000Z";

const openSet = changeSetView({ id: setId });
const appliedSet = changeSetView({
  id: setId,
  status: "applied",
  nextSteps: [{ kind: "revert" }],
  decision: { kind: "approved", via: "thread", by: "you", at },
});

const replied = (body: unknown): Replied => ({
  type: "replied",
  tag: { kind: "thread", id },
  ok: true,
  body,
});

const shown = (model: ThreadModel, changeSets: ChangeSetView[]): ThreadModel =>
  threadReplied(model, replied(threadView({ id, changeSets })))[0];

const opened = (changeSets: ChangeSetView[], address: string | null = null) =>
  shown(initThread(id, address)[0], changeSets);

const toggled = (model: ThreadModel, changeSetId: string) =>
  updateThread(model, { type: "foldToggled", changeSetId })[0];

// The page's timer, passed in: the `after` effects that ask for a beat to
// end, each sent back as if its time had passed.
const beats = (effects: Effect[]) =>
  effects.flatMap((effect) =>
    effect.type === "after" && effect.msg.type === "thread" && effect.msg.msg.type === "landed"
      ? [{ ms: effect.ms, changeSetId: effect.msg.msg.changeSetId }]
      : [],
  );
const landed = (model: ThreadModel, changeSetId: string) =>
  updateThread(model, { type: "landed", changeSetId });

// Loaded again with `changeSets`, then each beat asked for run to its end,
// closing included; with every effect along the way.
function settle(model: ThreadModel, changeSets: ChangeSetView[]): [ThreadModel, Effect[]] {
  let [next, effects] = threadReplied(model, replied(threadView({ id, changeSets })));
  const all = [...effects];
  const due = beats(effects);
  for (let beat = due.shift(); beat; beat = due.shift()) {
    [next, effects] = landed(next, beat.changeSetId);
    all.push(...effects);
    due.push(...beats(effects));
  }
  return [next, all];
}

test("a change set applied before the page opened is one line until shown, and folds again when hidden", () => {
  const model = opened([appliedSet]);
  assert.equal(folded(model, appliedSet), true);
  const open = toggled(model, setId);
  assert.equal(folded(open, appliedSet), false);
  assert.equal(folded(toggled(open, setId), appliedSet), true);
  // Awaiting review, it never folds.
  assert.equal(folded(opened([openSet]), openSet), false);
});

test("one applied while the page is open shows for a beat, closes, then folds itself, its Show taking focus", () => {
  const [model, effects] = threadReplied(
    opened([openSet]),
    replied(threadView({ id, changeSets: [appliedSet] })),
  );
  assert.equal(folded(model, appliedSet), false);
  assert.deepEqual(beats(effects), [{ ms: landMs, changeSetId: setId }]);
  // Loaded again during the beat, it asks for no second one.
  assert.deepEqual(
    beats(threadReplied(model, replied(threadView({ id, changeSets: [appliedSet] })))[1]),
    [],
  );
  const [closing, closes] = landed(model, setId);
  assert.equal(closing.landing[setId], "closing");
  assert.equal(folded(closing, appliedSet), false);
  assert.deepEqual(beats(closes), [{ ms: closeMs, changeSetId: setId }]);
  const [done, focus] = landed(closing, setId);
  assert.equal(folded(done, appliedSet), true);
  assert.deepEqual(focus, [{ type: "focusFolded", changeSetId: setId }]);
  assert.deepEqual(done.landed, [setId]);
  // Shown again by hand, it stays shown, and isn't said folded again.
  const open = toggled(done, setId);
  assert.equal(folded(open, appliedSet), false);
  assert.deepEqual(open.landed, []);
});

test("one that applied with errors, partly, or stalled stays shown", () => {
  const error = { mutationId: "m1", error: "Jira said no", sent: false };
  for (const set of [
    { ...appliedSet, errors: [error] },
    { ...appliedSet, status: "partial" as const },
    { ...appliedSet, status: "applying" as const, applying: true, stalled: true, nextSteps: [] },
  ]) {
    const [model, effects] = settle(opened([openSet]), [set]);
    assert.deepEqual(beats(effects), [], set.status);
    assert.equal(folded(model, set), false, set.status);
  }
});

test("one shown or hidden by hand during its beat keeps that, and takes no focus", () => {
  const [model] = threadReplied(
    opened([openSet]),
    replied(threadView({ id, changeSets: [appliedSet] })),
  );
  const hidden = toggled(model, setId);
  const [after, effects] = landed(hidden, setId);
  assert.equal(folded(after, appliedSet), true);
  assert.deepEqual([effects, after.landing, after.landed], [[], {}, []]);
  const shownAgain = toggled(hidden, setId);
  const [still, none] = landed(shownAgain, setId);
  assert.equal(folded(still, appliedSet), false);
  assert.deepEqual(none, []);
});

test("one the page's address names stays shown after its beat", () => {
  const [model, effects] = settle(opened([openSet], setId), [appliedSet]);
  assert.equal(beats(effects).length, 1);
  assert.equal(folded(model, appliedSet), false);
  assert.ok(!effects.some((effect) => effect.type === "focusFolded"));
});

test("an Undo awaiting review keeps the change set it reverts shown; once applied, both fold", () => {
  const undo = changeSetView({ id: undoId, revertOf: setId });
  const reverted = { ...appliedSet, nextSteps: [], reverts: [undoId] };
  const waiting = opened([reverted, undo]);
  assert.deepEqual([folded(waiting, reverted), folded(waiting, undo)], [false, false]);
  const undone = { ...undo, status: "applied" as const, nextSteps: [] };
  const settled = opened([reverted, undone]);
  assert.deepEqual([folded(settled, reverted), folded(settled, undone)], [true, true]);
  // An address naming the Undo opens the change set it sits in.
  assert.equal(folded(opened([reverted, undone], undoId), reverted), false);
});

test("an Undo applied while the page is open folds itself after its beat, and the change set it reverts with it", () => {
  const undo = changeSetView({ id: undoId, revertOf: setId });
  const reverted = { ...appliedSet, nextSteps: [], reverts: [undoId] };
  const undone = { ...undo, status: "applied" as const, nextSteps: [] };
  // The change set folded itself, then its Revert made an Undo to review.
  const [folded1] = settle(opened([openSet]), [appliedSet]);
  assert.equal(folded(folded1, appliedSet), true);
  const waiting = shown(folded1, [reverted, undo]);
  assert.deepEqual([folded(waiting, reverted), folded(waiting, undo)], [false, false]);
  const [model, effects] = threadReplied(
    waiting,
    replied(threadView({ id, changeSets: [reverted, undone] })),
  );
  assert.deepEqual([folded(model, reverted), folded(model, undone)], [false, false]);
  assert.deepEqual(
    beats(effects).map((beat) => beat.changeSetId),
    [setId, undoId],
  );
  const [settled] = settle(waiting, [reverted, undone]);
  assert.deepEqual([folded(settled, reverted), folded(settled, undone)], [true, true]);
});

test("one whose Undo opens during its beat stays shown, and folds after the Undo's", () => {
  const undo = changeSetView({ id: undoId, revertOf: setId });
  const reverted = { ...appliedSet, nextSteps: [], reverts: [undoId] };
  const [model] = threadReplied(
    opened([openSet]),
    replied(threadView({ id, changeSets: [appliedSet] })),
  );
  const waiting = shown(model, [reverted, undo]);
  const [after, effects] = landed(waiting, setId);
  assert.deepEqual([folded(after, reverted), effects], [false, []]);
  const undone = { ...undo, status: "applied" as const, nextSteps: [] };
  const [settled] = settle(after, [reverted, undone]);
  assert.equal(folded(settled, reverted), true);
});

test("a rejected Undo lets the change set it reverts fold again after a beat", () => {
  const undo = changeSetView({ id: undoId, revertOf: setId });
  const reverted = { ...appliedSet, reverts: [undoId] };
  const rejected = { ...undo, status: "rejected" as const, nextSteps: [] };
  const [model, effects] = settle(opened([reverted, undo]), [reverted, rejected]);
  assert.deepEqual(
    beats(effects)
      .filter((beat) => beat.ms === landMs)
      .map((beat) => beat.changeSetId),
    [setId],
  );
  assert.deepEqual([folded(model, reverted), folded(model, rejected)], [true, true]);
});
