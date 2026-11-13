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

test("a rejection's Undo asks the server to unreject it, once", () => {
  const model = after(clicked(onPage(), "reject"), decided({ changeSet: rejectedSet, undo }));
  assert.ok(notes(model).notes[0]?.onUndo, "it can be undone");
  const [undoing, asked] = update(model, { type: "rejected", msg: { type: "undoClicked" } });
  assert.deepEqual(sent(asked), [["POST", "/api/actions/changeset.unreject", undo.input]]);
  assert.deepEqual(
    sent(update(undoing, { type: "rejected", msg: { type: "undoClicked" } })[1]),
    [],
  );
});
