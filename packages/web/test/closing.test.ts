import assert from "node:assert/strict";
import { test } from "node:test";
import type { Effect, Replied } from "../src/http.ts";
import { init, type Model, type Msg, update } from "../src/root.ts";

const threadId = "01JBZ0000000000000000000T1";

const replied = (tag: Replied["tag"], body: unknown, ok = true): Msg => ({
  type: "replied",
  tag,
  ok,
  body,
});
const closing = (msg: Extract<Msg, { type: "closing" }>["msg"]): Msg => ({ type: "closing", msg });
const run = (model: Model, ...msgs: Msg[]): [Model, Effect[]] =>
  msgs.reduce<[Model, Effect[]]>(([m], msg) => update(m, msg), [model, []]);
const urls = (effects: Effect[]) =>
  effects.map((e) =>
    e.type === "http" ? `${e.method} ${e.url}` : e.type === "navigate" ? e.route : e.type,
  );

const nothing = { applied: 0, reverted: 0, unconfirmed: 0, sources: [] };

test("delete sends nothing until the person has been told what it would lose", () => {
  const [onThread] = init({ page: "thread", id: threadId });
  const [asking] = run(
    onThread,
    closing({ type: "deleteClicked", threadId, title: "Plan kiosk wallets", via: "menu" }),
  );
  assert.deepEqual(run(asking, closing({ type: "deleteConfirmed" }))[1], []);
  const [told] = run(asking, replied({ kind: "deletion", threadId }, nothing));
  assert.deepEqual(urls(run(told, closing({ type: "deleteConfirmed" }))[1]), [
    `POST /api/threads/${threadId}/delete`,
  ]);
});
test("cancelling a delete deletes nothing", () => {
  const [done] = init({ page: "done" });
  const [told] = run(
    done,
    closing({ type: "deleteClicked", threadId, title: "New thread", via: "menu" }),
    replied({ kind: "deletion", threadId }, nothing),
  );
  const [cancelled, none] = run(told, closing({ type: "deleteCancelled" }));
  assert.deepEqual([cancelled.closing.asking, none], [null, []]);
  assert.deepEqual(run(cancelled, closing({ type: "deleteConfirmed" }))[1], []);
});
