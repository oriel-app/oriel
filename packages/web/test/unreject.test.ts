// Rejecting in a thread can be undone from the bead (OA-258): the note says
// what was rejected, its Undo goes the one path every Undo takes, and a
// refusal, as once the person has told the agent what was wrong, says why
// until dismissed.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Effect, Replied } from "../src/http.ts";
import { rejectedUndos } from "../src/rejected.ts";
import { init, type Model, type Msg, update } from "../src/root.ts";
import { changeSetView, diffView, threadView } from "../testing.ts";

const id = "01JBZ0000000000000000000T1";
const setId = "01JBZ0000000000000000000C1";
const decision = "01JBZ0000000000000000000D1";
const undo = { action: "changeset.unreject", input: { changeSet: setId, decision } };

const replied = (tag: Replied["tag"], body: unknown, ok = true): Msg => ({
  type: "replied",
  tag,
  ok,
  body,
});
const after = (model: Model, msg: Msg): Model => update(model, msg)[0];
const sent = (effects: Effect[]) =>
  effects.flatMap((e) => (e.type === "http" ? [[e.method, e.url, e.body] as const] : []));

// On the thread's page, its change set diffed.
function onPage(): Model {
  let model = init({ page: "thread", id })[0];
  const view = threadView({
    id,
    title: "Estimate the launch",
    changeSets: [changeSetView({ id: setId, status: "open" })],
  });
  model = after(model, replied({ kind: "thread", id }, view));
  return after(
    model,
    replied({ kind: "diff", changeSetId: setId }, diffView({ changeSetId: setId })),
  );
}

const clicked = (model: Model, step: "approve" | "reject") =>
  after(model, { type: "thread", msg: { type: "changeSetClicked", changeSetId: setId, step } });
const decided = (body: unknown) =>
  replied({ kind: "changeSet", threadId: id, changeSetId: setId }, body);
const rejectedSet = changeSetView({ id: setId, status: "rejected" });
const notes = (model: Model) => rejectedUndos(model.rejected, () => {});

test("a rejection in the thread shows in the bead with Undo, which asks the server to undo it", () => {
  const [model, effects] = update(
    clicked(onPage(), "reject"),
    decided({ changeSet: rejectedSet, undo }),
  );
  const [note] = notes(model).notes;
  assert.equal(note?.said, "You rejected the change in “Estimate the launch”.");
  assert.ok(note?.onUndo, "it can be undone");
  assert.ok(
    effects.some((e) => e.type === "after"),
    "it runs out as every note does",
  );
  const [undoing, asked] = update(model, { type: "rejected", msg: { type: "undoClicked" } });
  assert.deepEqual(sent(asked), [["POST", "/api/actions/changeset.unreject", undo.input]]);
  assert.equal(notes(undoing).notes[0]?.disabled, true);
  // Twice is once.
  assert.deepEqual(
    sent(update(undoing, { type: "rejected", msg: { type: "undoClicked" } })[1]),
    [],
  );
  // Undone, the note goes, and the lists hear the thread waits on the person.
  const [undone, reload] = update(
    undoing,
    replied({ kind: "unrejected", changeSetId: setId }, { undo: null }),
  );
  assert.deepEqual(notes(undone), { notes: [], problem: null });
  assert.deepEqual(
    sent(reload).map(([, url]) => url),
    ["/api/threads", "/api/workstreams"],
  );
});

test("an Undo the server refuses says why until dismissed", () => {
  let model = after(clicked(onPage(), "reject"), decided({ changeSet: rejectedSet, undo }));
  model = after(model, { type: "rejected", msg: { type: "undoClicked" } });
  const why =
    "you've told the agent what was wrong since, so it is working from that rejection: ask it for the change again";
  model = after(model, replied({ kind: "unrejected", changeSetId: setId }, { error: why }, false));
  const { notes: shown, problem } = notes(model);
  assert.deepEqual(shown, []);
  assert.equal(problem?.said, `Couldn't undo it: ${why}`);
  assert.equal(problem?.key, `rejected-${setId}`, "it takes the note's place");
  model = after(model, { type: "rejected", msg: { type: "problemDismissed" } });
  assert.equal(notes(model).problem, null);
});

test("no note without an Undo, or for an approval", () => {
  const noUndo = after(
    clicked(onPage(), "reject"),
    decided({ changeSet: rejectedSet, undo: null }),
  );
  assert.deepEqual(notes(noUndo).notes, []);
  const approved = after(
    clicked(onPage(), "approve"),
    decided({ changeSet: changeSetView({ id: setId, status: "applied" }), undo: null }),
  );
  assert.deepEqual(notes(approved).notes, []);
  // A refusal to reject is no rejection.
  const refused = after(
    clicked(onPage(), "reject"),
    replied({ kind: "changeSet", threadId: id, changeSetId: setId }, { error: "stale" }, false),
  );
  assert.deepEqual(notes(refused).notes, []);
});
