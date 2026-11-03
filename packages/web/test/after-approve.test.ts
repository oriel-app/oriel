// After you approve (Settings, General): the page stays on the thread, or
// once Oriel accepts the approval it goes on to the next thread in Needs
// you, the one with a change set to review first, with a note that links
// back; with nothing else needing the user it stays and says so. Only
// Approve on a thread's own page moves it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { approvedText, approvedUndos } from "../src/approved.ts";
import type { Effect, Replied } from "../src/http.ts";
import { nav, nextNeedingYou } from "../src/nav.ts";
import { init, type Model, type Msg, update } from "../src/root.ts";
import type { AfterApprove, ThreadSummaryView } from "../src/view.ts";
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

test("next is the first other thread in Needs you with a change set to review, in its order", () => {
  const waiting = [
    summary(third, "reply", "2026-11-03T12:00:00.000Z"),
    summary(second, "review", "2026-11-03T11:00:00.000Z"),
    summary(id, "review", "2026-11-03T10:00:00.000Z"),
  ];
  assert.equal(nextNeedingYou(waiting, "elsewhere")?.id, second);
  // The thread just approved in is skipped, wherever it is in the list.
  assert.equal(nextNeedingYou(waiting, second)?.id, id);
});

test("with no other change set to review, next is the first other thread that needs the user", () => {
  const waiting = [
    summary(id, "review", "2026-11-03T12:00:00.000Z"),
    summary(second, "held", "2026-11-03T11:00:00.000Z"),
    summary(third, "reply", "2026-11-03T10:00:00.000Z"),
  ];
  assert.equal(nextNeedingYou(waiting, id)?.id, second);
});

test("with nothing else needing the user, there is no next", () => {
  assert.equal(nextNeedingYou([summary(id, "review", "2026-11-03T12:00:00.000Z")], id), null);
  assert.equal(nextNeedingYou([], id), null);
});

const replied = (tag: Replied["tag"], body: unknown, ok = true): Msg => ({
  type: "replied",
  tag,
  ok,
  body,
});

const step = (model: Model, msg: Msg): [Model, Effect[]] => update(model, msg);
const after = (model: Model, msg: Msg): Model => step(model, msg)[0];

const view = (threadId: string, title: string) =>
  threadView({
    id: threadId,
    title,
    workstream: { id: workstreamId, name: "Launch", version: 1 },
    changeSets: threadId === id ? [changeSetView({ id: setId, status: "open" })] : [],
  });

// On the thread's page, its change set diffed, with the setting picked and
// the sidebar's lists: the page's thread and `others` in Needs you.
function onPage(setting: AfterApprove, others: ThreadSummaryView[]): Model {
  let model = init({ page: "thread", id })[0];
  model = after(model, replied({ kind: "settings" }, settingsView({ afterApprove: setting })));
  model = after(model, replied({ kind: "thread", id }, view(id, "Estimate the launch")));
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
const answer = replied(
  { kind: "changeSet", threadId: id, changeSetId: setId },
  { changeSet: changeSetView({ id: setId, status: "applied" }), problem: null },
);
const navigations = (effects: Effect[]) =>
  effects.flatMap((effect) => (effect.type === "navigate" ? [effect.route] : []));
const said = (model: Model) => approvedUndos(model.approved).notes.map((note) => note.said);

const needing = [
  summary(second, "reply", "2026-11-03T11:00:00.000Z"),
  summary(third, "review", "2026-11-03T10:00:00.000Z"),
];

test("going on, the page moves once the apply starts, to the next change set to review, with a note back", () => {
  const approving = approve(onPage("next", needing));
  // Sent, not yet accepted: the page stays.
  assert.deepEqual(said(approving), []);
  const [moved, effects] = step(approving, applying);
  assert.deepEqual(navigations(effects), [{ page: "thread", id: third }]);
  const notes = approvedUndos(moved.approved).notes;
  assert.deepEqual(
    notes.map((note) => [note.said, note.link?.route, note.link?.label]),
    [
      [
        "You approved “Estimate the launch”. Applying…",
        { page: "thread", id },
        "Back to “Estimate the launch”",
      ],
    ],
  );
  assert.equal(notes[0]?.heard, "Now on “Thread T3”, the next thread that needs you.");
});

test("arriving, the note stays and the heading takes focus once the thread loads, and once only", () => {
  const [moved] = step(approve(onPage("next", needing)), applying);
  const arrived = after(moved, { type: "routed", route: { page: "thread", id: third } });
  assert.deepEqual(said(arrived), ["You approved “Estimate the launch”. Applying…"]);
  const [loaded, effects] = step(
    arrived,
    replied({ kind: "thread", id: third }, view(third, "T3")),
  );
  assert.ok(effects.some((effect) => effect.type === "focusHeading"));
  const [, again] = step(loaded, replied({ kind: "thread", id: third }, view(third, "T3")));
  assert.ok(!again.some((effect) => effect.type === "focusHeading"));
  // The approval's own answer, once the apply ends, moves nothing.
  const [, late] = step(loaded, answer);
  assert.deepEqual(navigations(late), []);
  // Leaving the page it went to, the note goes.
  const left = after(loaded, { type: "routed", route: { page: "overview" } });
  assert.deepEqual(said(left), []);
});

test("an approval answered before its stream says so moves the page all the same, once", () => {
  const [moved, effects] = step(approve(onPage("next", needing)), answer);
  assert.deepEqual(navigations(effects), [{ page: "thread", id: third }]);
  const [, again] = step(moved, applying);
  assert.deepEqual(navigations(again), []);
});

test("with nothing else needing the user, the page stays and says so, once", () => {
  const [stayed, effects] = step(approve(onPage("next", [])), applying);
  assert.deepEqual(navigations(effects), []);
  assert.deepEqual(said(stayed), ["Nothing else needs you."]);
  assert.equal(approvedUndos(stayed.approved).notes[0]?.link, undefined);
  // Once it runs out, the approval's answer doesn't say it again.
  const expired = after(stayed, {
    type: "approved",
    msg: { type: "expired", countdown: stayed.approved.countdown },
  });
  assert.deepEqual(said(expired), []);
  assert.deepEqual(said(after(expired, answer)), []);
});

test("staying, as the default, the page stays and says nothing", () => {
  const [stayed, effects] = step(approve(onPage("stay", needing)), applying);
  assert.deepEqual(navigations(effects), []);
  assert.deepEqual(said(stayed), []);
});

test("a refused approval, or an apply started elsewhere, moves nothing", () => {
  const refused = replied(
    { kind: "changeSet", threadId: id, changeSetId: setId },
    { error: "The change set changed since you saw it." },
    false,
  );
  const [, effects] = step(approve(onPage("next", needing)), refused);
  assert.deepEqual(navigations(effects), []);
  // Approving through its review link: this page sent nothing.
  const [elsewhere, started] = step(onPage("next", needing), applying);
  assert.deepEqual(navigations(started), []);
  assert.deepEqual(said(elsewhere), []);
});

test("the note says it in words and the sidebar's list is what it reads", () => {
  const model = approve(onPage("next", needing));
  assert.deepEqual(
    nav(model).waiting.map((each) => each.id),
    [second, third],
  );
  assert.deepEqual(
    approvedText({
      changeSetId: setId,
      left: { id, title: null },
      to: { id: second, title: null },
      arrived: false,
      focused: false,
    }),
    {
      said: "You approved “New thread”. Applying…",
      heard: "Now on “New thread”, the next thread that needs you.",
    },
  );
});
