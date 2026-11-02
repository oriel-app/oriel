// Ending a workstream offers the same Undo as everything else (OA-142): what
// was done shows as a note in the one stack, runs out after the same few
// seconds a removal's Undo does, holds while the pointer or focus is on the
// stack, and starts its full time again once let go. A deleted workstream's
// page still says it went after its Undo runs out.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  around,
  deleted,
  type EndingModel,
  type EndingMsg,
  endingAnswered,
  initEnding,
  leftPage,
  updateEnding,
} from "../src/ending.ts";
import type { Effect, Replied } from "../src/http.ts";
import { init, update } from "../src/root.ts";
import { latestNote, undoMs } from "../src/undos.ts";
import type { Removal } from "../src/workstream.ts";
import { memberView, workstreamView } from "../testing.ts";

const workstreamId = "01JBZ0000000000000000000G1";
const restore = { action: "workstream.restore", input: { workstream: workstreamId } };
const reopen = {
  action: "workstream.reopen",
  input: { workstream: workstreamId, mark: "2026-10-30T09:00:00.000Z" },
};

const answer = (how: "done" | "deleted", body: unknown): Replied => ({
  type: "replied",
  tag: { kind: "ended", id: workstreamId, how, name: "Launch" },
  ok: true,
  body,
});

const expiries = (effects: readonly Effect[]) =>
  effects.flatMap((e) => (e.type === "after" ? [[e.ms, e.msg] as const] : []));

const expired = (countdown: number): EndingMsg => ({ type: "undoExpired", countdown });
const step = (model: EndingModel, msg: EndingMsg) => updateEnding(model, msg)[0];

test("what was done runs out after as long as a removal's Undo, by the same timer", () => {
  const [marked, effects] = endingAnswered(
    initEnding(),
    answer("done", { ...workstreamView(), carried: 0, undo: reopen }),
    [],
  );
  assert.equal(marked.shown, true);
  assert.deepEqual(expiries(effects), [
    [undoMs, { type: "ending", msg: expired(marked.countdown) }],
  ]);
  assert.equal(step(marked, expired(marked.countdown)).shown, false);
  // Its Undo has gone with it.
  const late = step(marked, expired(marked.countdown));
  assert.deepEqual(updateEnding(late, { type: "undoClicked" })[1], []);
});

test("the ending's countdown starts from the app, wherever the user is", () => {
  const [onDone] = init({ page: "done" });
  const [, effects] = update(
    onDone,
    answer("done", { ...workstreamView(), carried: 0, undo: reopen }),
  );
  assert.equal(expiries(effects).length, 1);
});

test("held by the pointer or keyboard, it stays; let go, it gets its full time again", () => {
  const [marked] = endingAnswered(
    initEnding(),
    answer("done", { ...workstreamView(), carried: 0, undo: reopen }),
    [],
  );
  let model = step(marked, { type: "undoHeld", by: "pointer", held: true });
  model = step(model, { type: "undoHeld", by: "focus", held: true });
  assert.equal(step(model, expired(model.countdown)).shown, true);
  // The pointer goes, the keyboard still holds it: nothing starts.
  const [focused, none] = updateEnding(model, { type: "undoHeld", by: "pointer", held: false });
  assert.deepEqual(expiries(none), []);
  const [released, restarts] = updateEnding(focused, {
    type: "undoHeld",
    by: "focus",
    held: false,
  });
  assert.deepEqual(expiries(restarts), [
    [undoMs, { type: "ending", msg: expired(released.countdown) }],
  ]);
  // Only the countdown that started last hides it.
  assert.equal(step(released, expired(marked.countdown)).shown, true);
  assert.equal(step(released, expired(released.countdown)).shown, false);
});

test("its Undo lets go of the keyboard's hold, as a removal's does", () => {
  const [marked] = endingAnswered(
    initEnding(),
    answer("done", { ...workstreamView(), carried: 0, undo: reopen }),
    [],
  );
  const held = step(marked, { type: "undoHeld", by: "focus", held: true });
  const [undoing] = updateEnding(held, { type: "undoClicked" });
  assert.deepEqual(undoing.held, { pointer: false, focus: false });
});

test("once a deleted workstream's Undo runs out, its page still says it went", () => {
  const [gone] = endingAnswered(initEnding(), answer("deleted", { threads: 2, undo: restore }), []);
  const after = step(gone, expired(gone.countdown));
  assert.equal(after.shown, false);
  assert.equal(deleted(after, workstreamId), true);
});

test("leaving the page lets go of what held it, so the next one runs out", () => {
  const [marked] = endingAnswered(
    initEnding(),
    answer("done", { ...workstreamView(), carried: 0, undo: reopen }),
    [],
  );
  const left = leftPage(step(marked, { type: "undoHeld", by: "pointer", held: true }));
  assert.deepEqual([left.shown, left.held], [false, { pointer: false, focus: false }]);
  const [again] = endingAnswered(left, answer("deleted", { threads: 0, undo: restore }), []);
  assert.ok(again.countdown > marked.countdown, "a new countdown, not the old one's");
  assert.equal(step(again, expired(again.countdown)).shown, false);
});

test("in the page's stack, removals made before it sit above what was done, and later ones below, where ⌘Z reaches them first", () => {
  const removal = (version: number): Removal => ({
    member: memberView(),
    version,
    countdown: 0,
    undo: { action: "workstream.add", input: {} },
  });
  const [onPage] = init({ page: "workstream", id: workstreamId });
  const removed = onPage.workstream && { ...onPage.workstream, removals: [removal(4)] };
  assert.ok(removed);
  const [marked] = update(
    { ...onPage, workstream: removed },
    answer("done", { ...workstreamView(), carried: 0, undo: reopen }),
  );
  assert.deepEqual(marked.ending.above, [4]);
  const [before, since] = around(marked.ending, [removal(4), removal(5)]);
  const notes = [
    ...before.map((each) => ({ key: `${each.version}`, onUndo: each.undo })),
    { key: "ended", onUndo: reopen },
    ...since.map((each) => ({ key: `${each.version}`, onUndo: each.undo })),
  ];
  assert.deepEqual(
    notes.map((note) => note.key),
    ["4", "ended", "5"],
  );
  assert.equal(latestNote(notes)?.key, "5");
  // With none since, ⌘Z undoes what was done.
  assert.equal(latestNote(notes.slice(0, 2))?.key, "ended");
});
