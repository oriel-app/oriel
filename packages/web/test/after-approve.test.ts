// After you approve with "go on" set (Settings, General): another change set
// awaiting review in the same thread comes before any other thread, and a
// thread still waiting on the user is never "all caught up" (OA-259, #206).
import assert from "node:assert/strict";
import { test } from "node:test";
import { approvedUndos } from "../src/approved.ts";
import type { Effect, Replied } from "../src/http.ts";
import { init, type Model, type Msg, update } from "../src/root.ts";
import type { ChangeSetView, ChatEntry, ThreadSummaryView } from "../src/view.ts";
import {
  changeSetView,
  diffView,
  settingsView,
  threadSummary,
  threadView,
  workstreamSummary,
} from "../testing.ts";

const id = "01JBZ0000000000000000000T1";
const second = "01JBZ0000000000000000000T2";
const third = "01JBZ0000000000000000000T3";
const workstreamId = "01JBZ0000000000000000000G1";
const setId = "01JBZ0000000000000000000C1";
const otherSet = "01JBZ0000000000000000000C2";

const summary = (
  threadId: string,
  waitingOn: ThreadSummaryView["waitingOn"],
  activityAt: string,
): ThreadSummaryView =>
  threadSummary({
    id: threadId,
    title: `Thread ${threadId.slice(-2)}`,
    workstream: { id: workstreamId, name: "Launch" },
    state: "working",
    waitingOn,
    activityAt,
  });

const replied = (tag: Replied["tag"], body: unknown, ok = true): Msg => ({
  type: "replied",
  tag,
  ok,
  body,
});

const step = (model: Model, msg: Msg): [Model, Effect[]] => update(model, msg);
const after = (model: Model, msg: Msg): Model => step(model, msg)[0];

// On the thread's page, its change set diffed, "go on" picked, and `others`
// in Needs you. The thread holds `changeSets` and `entries` when given.
function onPage(
  others: ThreadSummaryView[],
  changeSets: ChangeSetView[] = [changeSetView({ id: setId, status: "open" })],
  entries: ChatEntry[] = [],
): Model {
  let model = init({ page: "thread", id })[0];
  model = after(model, replied({ kind: "settings" }, settingsView({ afterApprove: "next" })));
  model = after(
    model,
    replied(
      { kind: "thread", id },
      threadView({
        id,
        title: "Estimate the launch",
        workstream: { id: workstreamId, name: "Launch", version: 1 },
        changeSets,
        entries,
      }),
    ),
  );
  model = after(
    model,
    replied({ kind: "diff", changeSetId: setId }, diffView({ changeSetId: setId })),
  );
  model = after(
    model,
    replied(
      { kind: "workstreams" },
      { workstreams: [workstreamSummary({ id: workstreamId, name: "Launch" })] },
    ),
  );
  return after(
    model,
    replied(
      { kind: "threads" },
      { threads: [summary(id, "review", "2026-11-03T12:00:00.000Z"), ...others] },
    ),
  );
}

const approve = (model: Model) =>
  after(model, {
    type: "thread",
    msg: { type: "changeSetClicked", changeSetId: setId, step: "approve" },
  });
const applying: Msg = {
  type: "streamed",
  event: { type: "change-set", changeSetId: setId, applying: true },
};
const navigations = (effects: Effect[]) =>
  effects.flatMap((effect) => (effect.type === "navigate" ? [effect.route] : []));
const scrolls = (effects: Effect[]) =>
  effects.flatMap((effect) => (effect.type === "showChangeSet" ? [effect.changeSetId] : []));
const marks = (model: Model) =>
  approvedUndos(model.approved, () => {}).notes.map((note) => note.mark);
const awaiting = (changeSetId: string) => changeSetView({ id: changeSetId, status: "open" });

const needing = [
  summary(second, "reply", "2026-11-03T11:00:00.000Z"),
  summary(third, "review", "2026-11-03T10:00:00.000Z"),
];

test("going on, another change set to review in the same thread keeps the page there, before or after the one approved", () => {
  for (const sets of [
    [awaiting(otherSet), awaiting(setId)],
    [awaiting(setId), awaiting(otherSet)],
  ]) {
    const [, effects] = step(approve(onPage(needing, sets)), applying);
    assert.deepEqual(navigations(effects), []);
    assert.deepEqual(scrolls(effects), [otherSet]);
  }
});

test("with this thread still holding a message for the user, the page stays and isn't all caught up", () => {
  const held: ChatEntry = {
    kind: "held",
    seq: 3,
    at: "2026-11-03T12:00:00.000Z",
    from: { kind: "review-link", by: "Amara", changeSetId: otherSet },
    text: "Not this sprint.",
    outcome: null,
  };
  const [stayed, effects] = step(approve(onPage([], undefined, [held])), applying);
  assert.deepEqual(navigations(effects), []);
  assert.deepEqual(marks(stayed), ["applying"]);
});
