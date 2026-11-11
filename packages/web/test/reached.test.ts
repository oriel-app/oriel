// OA-102, fixed in c27653bc (#91): a thread's page that said Oriel can't be
// reached stayed so after Oriel came back, hiding whether an Approve sent as
// it restarted had applied. Once its stream reconnects it loads again.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type Effect, type Tag, unreachable } from "../src/http.ts";
import { init, type Model, type Msg, update } from "../src/root.ts";
import { changeSetView, diffView, threadView } from "../testing.ts";

const threadId = "01JBZ0000000000000000000T1";
const setId = "01JBZ0000000000000000000C1";

function run(model: Model, ...msgs: Msg[]): [Model, Effect[]] {
  let effects: Effect[] = [];
  for (const msg of msgs) [model, effects] = update(model, msg);
  return [model, effects];
}

const replied = (tag: Tag, body: unknown, ok = true): Msg => ({ type: "replied", tag, ok, body });
const away = { error: unreachable };
const requests = (effects: readonly Effect[]) =>
  effects.flatMap((e) => (e.type === "http" ? [{ url: e.url, tag: e.tag }] : []));

test("a thread's page, once its stream is back, loads again and stops saying Oriel can't be reached", () => {
  const open = changeSetView({ id: setId, status: "open", nextSteps: [{ kind: "approve" }] });
  const view = threadView({ id: threadId, changeSets: [open], lastSeq: 2 });
  const diff = diffView({ changeSetId: setId, hash: "h" });
  const [shown] = run(
    init({ page: "thread", id: threadId })[0],
    replied({ kind: "thread", id: threadId }, view),
    replied({ kind: "diff", changeSetId: setId }, diff),
  );
  // Approve goes out as Oriel restarts: it may have landed, but no answer came.
  const [down] = run(
    shown,
    { type: "thread", msg: { type: "changeSetClicked", changeSetId: setId, step: "approve" } },
    replied({ kind: "changeSet", threadId, changeSetId: setId }, away, false),
    { type: "thread", msg: { type: "doneClicked" } },
    replied({ kind: "threadAction", threadId }, away, false),
  );
  assert.equal(down.thread?.notice, unreachable);
  assert.equal(down.thread?.problems[setId], unreachable);
  // The stream reconnects: the thread and its change set load again.
  const [back, effects] = run(down, { type: "streamReopened", stream: "thread" });
  const loads = requests(effects);
  const load = loads.find((r) => r.tag.kind === "thread");
  const diffed = loads.find((r) => r.tag.kind === "diff");
  assert.ok(load && diffed);
  // They show what happened: it applied.
  const applied = changeSetView({ id: setId, status: "applied", nextSteps: [{ kind: "revert" }] });
  const [after] = run(
    back,
    replied(load.tag, { ...view, changeSets: [applied] }),
    replied(diffed.tag, diff),
  );
  assert.equal(after.thread?.notice, null);
  assert.equal(after.thread?.problems[setId], undefined);
  assert.equal(after.thread?.view?.changeSets[0]?.status, "applied");
});

// OA-126: the window and the Done page kept saying Oriel can't be reached
// after it came back, until the person went to another page; only a thread's
// stream reconnecting took the notice back.
test("every other page, once the threads stream is back, loads again and stops saying Oriel can't be reached", () => {
  const back: Msg = { type: "streamReopened", stream: "threads" };
  // The window's overview failed to load as Oriel restarted.
  const [overview] = run(init({ page: "overview" })[0], replied({ kind: "overview" }, away, false));
  assert.equal(overview.overview?.problem, unreachable);
  const [shown, loads] = run(overview, back);
  assert.equal(shown.overview?.problem, null);
  assert.ok(requests(loads).some((r) => r.tag.kind === "overview"));
  // Marked done on the Done page as Oriel restarted: it may have landed.
  const [done] = run(
    init({ page: "done" })[0],
    { type: "closing", msg: { type: "markDoneClicked", threadId, via: "menu" } },
    replied({ kind: "markedDone", threadId }, away, false),
  );
  assert.equal(done.closing.problem, unreachable);
  const [after, again] = run(done, back);
  assert.equal(after.closing.problem, null);
  assert.ok(requests(again).some((r) => r.tag.kind === "threads"));
});
