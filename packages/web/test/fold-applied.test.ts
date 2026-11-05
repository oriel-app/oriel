// An applied change set folds to one line, its Revert a click away; one
// applied while the page is open stays shown until the page is left, and an
// Undo still waiting on the person keeps the set it reverts shown.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Replied } from "../src/http.ts";
import {
  folded,
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

test("a change set applied before the page opened is one line until shown, and folds again when hidden", () => {
  const model = opened([appliedSet]);
  assert.equal(folded(model, appliedSet), true);
  const open = toggled(model, setId);
  assert.equal(folded(open, appliedSet), false);
  assert.equal(folded(toggled(open, setId), appliedSet), true);
  // Awaiting review, it never folds.
  assert.equal(folded(opened([openSet]), openSet), false);
});

test("one applied while the page is open stays shown until the page is left, and folds when hidden", () => {
  const model = shown(opened([openSet]), [appliedSet]);
  assert.equal(folded(model, appliedSet), false);
  assert.equal(folded(toggled(model, setId), appliedSet), true);
  assert.equal(folded(opened([appliedSet]), appliedSet), true);
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
