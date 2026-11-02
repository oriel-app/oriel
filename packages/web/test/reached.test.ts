// The window recovers by itself when Oriel comes back (OA-102): a page that
// said Oriel can't be reached loads what's on screen again once its stream
// reconnects, and stops saying so, showing what actually happened.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type Effect, type Tag, unreachable } from "../src/http.ts";
import { init, type Model, type Msg, update } from "../src/root.ts";
import {
  changeSetView,
  diffView,
  threadView,
  workstreamSummary,
  workstreamView,
} from "../testing.ts";

const threadId = "01JBZ0000000000000000000T1";
const workstreamId = "01JBZ0000000000000000000G1";
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
  const [back, effects] = run(down, { type: "streamReopened" });
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

test("a thread's notice of anything else stays when it loads again", () => {
  const [shown] = run(
    init({ page: "thread", id: threadId })[0],
    replied({ kind: "thread", id: threadId }, threadView({ id: threadId })),
    { type: "thread", msg: { type: "draftChanged", text: "Any risks?" } },
    { type: "thread", msg: { type: "sendClicked" } },
    replied({ kind: "sent", threadId }, { error: "The agent is still answering." }, false),
  );
  const [after] = run(
    shown,
    replied({ kind: "thread", id: threadId }, threadView({ id: threadId })),
  );
  assert.equal(after.thread?.notice, "The agent is still answering.");
});

test("a workstream's page, once Oriel is back, loads again and stops saying it can't be reached", () => {
  const view = workstreamView({ workstream: workstreamSummary({ name: "Launch" }) });
  const [shown] = run(
    init({ page: "workstream", id: workstreamId })[0],
    replied({ kind: "workstream", id: workstreamId }, view),
    { type: "workstream", msg: { type: "nameEdited", name: "Gates" } },
    { type: "workstream", msg: { type: "nameSaved" } },
    replied({ kind: "renamed", id: workstreamId }, away, false),
  );
  assert.equal(shown.workstream?.notice, unreachable);
  // The page's watch on the workspace opens again, as it does after any drop.
  const [back, effects] = run(shown, { type: "threadsMoved" });
  const load = requests(effects).find((r) => r.tag.kind === "workstreamSynced");
  assert.ok(load);
  const renamed = workstreamView({ workstream: workstreamSummary({ name: "Gates", version: 1 }) });
  const [after] = run(back, replied(load.tag, renamed));
  assert.equal(after.workstream?.notice, null);
  assert.equal(after.workstream?.view?.workstream.name, "Gates");
});
