// The one countdown every Undo note runs on (OA-171): its full time, ended
// only by the latest countdown, held while the pointer or keyboard is on the
// stack, and started again once let go. The overview's notes run on it, as
// the workstream page's and the ending's do.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Effect } from "../src/http.ts";
import { init, type Model, type Msg, update } from "../src/root.ts";
import { type Counting, hold, notHeld, restart, runsOut, undoMs } from "../src/undos.ts";
import { workstreamSummary } from "../testing.ts";

const expired = (countdown: number): Msg => ({
  type: "overview",
  msg: { type: "undoExpired", countdown },
});

const expiries = (effects: readonly Effect[]) =>
  effects.flatMap((e) => (e.type === "after" ? [[e.ms, e.msg] as const] : []));

function run(model: Model, ...msgs: Msg[]): [Model, Effect[]] {
  let effects: Effect[] = [];
  for (const msg of msgs) [model, effects] = update(model, msg);
  return [model, effects];
}

test("a countdown runs its full time, and only the latest one's end hides the notes", () => {
  const start: Counting = { held: notHeld, countdown: 0 };
  const [first, ends] = restart(start, expired);
  assert.deepEqual(expiries(ends), [[undoMs, expired(1)]]);
  assert.equal(runsOut(first, 1), true);
  const [second] = restart(first, expired);
  assert.equal(runsOut(second, 1), false);
  assert.equal(runsOut(second, 2), true);
});

test("held by pointer or keyboard, nothing runs out; let go of by both, it starts again", () => {
  const [counting] = restart({ held: notHeld, countdown: 0 }, expired);
  const again = (model: Counting) => restart(model, expired);
  const [pointer] = hold(counting, "pointer", true, again);
  const [both] = hold(pointer, "focus", true, again);
  assert.equal(runsOut(both, 1), false);
  const [focus, none] = hold(both, "pointer", false, again);
  assert.deepEqual(none, []);
  assert.equal(runsOut(focus, 1), false);
  const [free, restarts] = hold(focus, "focus", false, again);
  assert.deepEqual(expiries(restarts), [[undoMs, expired(2)]]);
  assert.equal(runsOut(free, 1), false);
  assert.equal(runsOut(free, 2), true);
  // Letting go of what nothing held starts nothing.
  assert.deepEqual(hold(free, "pointer", false, again)[1], []);
});

const made = (key: string, id: string): Msg => ({
  type: "replied",
  tag: { kind: "overviewMade", key, grouping: "linked" },
  ok: true,
  body: {
    ...workstreamSummary({ id }),
    undo: { action: "workstream.delete", input: { workstream: id } },
  },
});

test("a workstream made on the overview shows with its Undo until its countdown runs out", () => {
  const [shown, effects] = run(init({ page: "overview" })[0], made("jira:1", "W1"));
  const countdown = shown.overview?.countdown ?? 0;
  assert.deepEqual(expiries(effects), [[undoMs, expired(countdown)]]);
  const [gone] = run(shown, expired(countdown));
  assert.deepEqual(gone.overview?.made, []);
});

test("an Undo sent during the countdown outlasts it, and the rest restart once its focus goes", () => {
  const [both] = run(init({ page: "overview" })[0], made("jira:1", "W1"), made("jira:2", "W2"));
  const before = both.overview?.countdown ?? 0;
  const [focused] = run(both, { type: "undoHeld", by: "focus", held: true });
  const [undoing, effects] = run(focused, {
    type: "overview",
    msg: { type: "undoClicked", key: "jira:1" },
  });
  // Its Undo leaving lets go of the keyboard's hold: the rest get their full time.
  const after = undoing.overview?.countdown ?? 0;
  assert.ok(after > before);
  assert.deepEqual(expiries(effects), [[undoMs, expired(after)]]);
  assert.equal(run(undoing, expired(before))[0].overview?.made.length, 2);
  // Its countdown ends while the Undo is on its way: only the other goes.
  const [ran] = run(undoing, expired(after));
  assert.deepEqual(
    ran.overview?.made.map((each) => [each.key, each.undoing]),
    [["jira:1", true]],
  );
});
