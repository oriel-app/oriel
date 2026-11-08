// A move's Undo (moving.ts) sends back two calls. Keep class 2, an Undo
// a person relies on: an answer to one Undo can't take another move's Undo
// away, and an Undo tried again after one call failed sends only that one.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Effect, Replied } from "../src/http.ts";
import {
  type Carried,
  initMoving,
  type MovingModel,
  movingReplied,
  updateMoving,
} from "../src/moving.ts";

const a = { id: "01JBZ0000000000000000000A1", name: "Checkout" };
const b = { id: "01JBZ0000000000000000000B1", name: "Gift cards" };
const item: Carried = { id: "jira:SYN-23", key: "SYN-23", title: null, from: a };

const replied = (tag: Replied["tag"], body: unknown, ok = true): Replied => ({
  type: "replied",
  tag,
  ok,
  body,
});

const requests = (effects: readonly Effect[]) =>
  effects.flatMap((e) => (e.type === "http" ? [`${e.method} ${e.url}`] : []));

const out = { action: "workstream.remove", input: { workstream: b.id, items: [item.id] } };
const back = { action: "workstream.add", input: { workstream: a.id, items: [item.id] } };

// SYN-23 moved from Checkout to Gift cards.
function moved(): MovingModel {
  const [joining] = updateMoving(initMoving(), { type: "dropped", item, to: b });
  const [leaving] = movingReplied(joining, replied({ kind: "moveJoined" }, { undo: out }));
  return movingReplied(leaving, replied({ kind: "moveLeft" }, { undo: back }))[0];
}

test("no move starts while another's Undo is answering, so its answers can't clear the new move", () => {
  const [undoing, sent] = updateMoving(moved(), { type: "undoClicked" });
  assert.equal(requests(sent).length, 2);
  const [still, none] = updateMoving(undoing, { type: "dropped", item, to: b });
  assert.deepEqual(requests(none), []);
  assert.equal(still.pending, null);
});

test("an Undo tried again after one call failed sends only that one, and then it's done", () => {
  const [undoing] = updateMoving(moved(), { type: "undoClicked" });
  const [half] = movingReplied(
    undoing,
    replied({ kind: "moveUndone", action: "workstream.remove" }, { undo: null }),
  );
  const [failed] = movingReplied(
    half,
    replied({ kind: "moveUndone", action: "workstream.add" }, { error: "offline" }, false),
  );
  assert.notEqual(failed.problem, null);
  const [again, sent] = updateMoving(failed, { type: "undoClicked" });
  assert.deepEqual(requests(sent), ["POST /api/actions/workstream.add"]);
  const [done] = movingReplied(
    again,
    replied({ kind: "moveUndone", action: "workstream.add" }, { undo: null }),
  );
  assert.equal(done.moved, null);
  assert.equal(done.problem, null);
});
