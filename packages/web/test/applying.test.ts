import assert from "node:assert/strict";
import { test } from "node:test";
import type { Replied } from "../src/http.ts";
import { nav } from "../src/nav.ts";
import { init, type Model, update } from "../src/root.ts";
import { expected, initThread, threadReplied, type ThreadModel } from "../src/thread.ts";
import type { ChangeSetView, ThreadSummaryView, ThreadView } from "../src/view.ts";
import {
  changeSetView,
  diffView,
  threadSummary,
  threadView,
  workstreamSummary,
} from "../testing.ts";

const id = "01JBZ0000000000000000000T1";
const other = "01JBZ0000000000000000000T2";
const workstreamId = "01JBZ0000000000000000000G1";
const setId = "01JBZ0000000000000000000C1";
const secondSet = "01JBZ0000000000000000000C2";
const at = "2026-10-31T09:00:00.000Z";

const open = (changeSetId: string): ChangeSetView =>
  changeSetView({
    id: changeSetId,
    status: "open",
    nextSteps: [{ kind: "approve" }, { kind: "reject" }],
    applying: false,
    decision: null,
  });

const viewWith = (changeSets: ChangeSetView[]): ThreadView =>
  threadView({
    id,
    title: "Estimate the launch",
    workstream: { id: workstreamId, name: "Launch", version: 1 },
    state: "working",
    running: false,
    changeSets,
    writable: true,
  });

const summary = (
  threadId: string,
  waitingOn: ThreadSummaryView["waitingOn"],
  state: ThreadSummaryView["state"] = "working",
): ThreadSummaryView =>
  threadSummary({
    id: threadId,
    title: "Estimate the launch",
    workstream: { id: workstreamId, name: "Launch" },
    state,
    doneBy: state === "done" ? "applied" : null,
    waitingOn,
  });

const replied = (tag: Replied["tag"], body: unknown, ok = true): Replied => ({
  type: "replied",
  tag,
  ok,
  body,
});

// A thread's page with its change sets loaded and diffed, as Approve needs,
// and the sidebar's lists.
function onPage(changeSets = [open(setId)]): Model {
  let [thread] = initThread(id);
  [thread] = threadReplied(thread, replied({ kind: "thread", id }, viewWith(changeSets)));
  for (const set of changeSets)
    [thread] = threadReplied(
      thread,
      replied({ kind: "diff", changeSetId: set.id }, diffView({ changeSetId: set.id, hash: "h" })),
    );
  return {
    ...init({ page: "thread", id })[0],
    thread,
    workstreams: [
      workstreamSummary({
        id: workstreamId,
        name: "Launch",
        threads: { working: 2, done: 0, "handed-off": 0, dropped: 0 },
      }),
    ],
    threads: [summary(id, "review"), summary(other, "review")],
  };
}

const click = (model: Model, step: "approve" | "reject", changeSetId = setId) =>
  update(model, { type: "thread", msg: { type: "changeSetClicked", changeSetId, step } })[0];

const waiting = (model: Model) => nav(model).waiting.map((each) => each.id);
// What the sidebar's workstream, and the workstream's page, say the thread waits on.
const waitsOn = (model: Model, threadId = id) =>
  nav(model)
    .workstreams?.flatMap((workstream) => workstream.threads)
    .find((each) => each.id === threadId)?.waitingOn;

const answered = (model: Model, body: unknown, ok = true) =>
  update(model, replied({ kind: "changeSet", threadId: id, changeSetId: setId }, body, ok))[0];

const listed = (model: Model, threads: ThreadSummaryView[]): Model =>
  update(model, replied({ kind: "threads" }, { threads }))[0];

test("Approve and apply takes the thread out of Needs you at once, shown as applying", () => {
  const model = onPage();
  assert.deepEqual(waiting(model), [id, other]);
  const approving = click(model, "approve");
  assert.deepEqual(waiting(approving), [other]);
  assert.equal(nav(approving).needsYou, 1);
  assert.equal(waitsOn(approving), "apply");
  assert.equal(waitsOn(approving, other), "review");
  // The thread's own page says so, with nothing left to click.
  const set = expected(approving.thread as ThreadModel)?.changeSets[0];
  assert.deepEqual([set?.status, set?.nextSteps], ["applying", []]);
});

test("a reload mid-apply says the same; once applied, the thread is done", () => {
  const approving = click(onPage(), "approve");
  // The server, asked mid-apply: out of Needs you.
  const midApply = listed(approving, [summary(id, "apply"), summary(other, "review")]);
  assert.deepEqual(waiting(midApply), [other]);
  assert.equal(waitsOn(midApply), "apply");
  // Applied while the sync still runs: done, whatever the click expected.
  const applied = listed(approving, [summary(id, null, "done"), summary(other, "review")]);
  assert.deepEqual(waiting(applied), [other]);
  assert.deepEqual(
    nav(applied).finished.map((each) => each.id),
    [id],
  );
  // Answered: still out.
  const done = answered(applied, { changeSet: { ...open(setId), status: "applied" } });
  assert.deepEqual(waiting(done), [other]);
  assert.deepEqual(done.thread?.deciding, {});
});

test("a failed apply puts the thread back in Needs you, with why on the change set", () => {
  const approving = click(onPage(), "approve");
  // The apply stopped: the server's list says review again, and the click
  // still hides it until its answer says why.
  const stopped = listed(approving, [summary(id, "review"), summary(other, "review")]);
  assert.deepEqual(waiting(stopped), [other]);
  const failed = answered(stopped, {
    changeSet: { ...open(setId), status: "stopped", nextSteps: [{ kind: "retry" }] },
    problem: "Jira said no",
  });
  assert.deepEqual(waiting(failed), [id, other]);
  assert.equal(failed.thread?.problems[setId], "Jira said no");
  assert.deepEqual(failed.thread?.deciding, {});
  // A refused decision, too.
  const refused = answered(approving, { error: "The change set changed since you saw it." }, false);
  assert.deepEqual(waiting(refused), [id, other]);
  assert.equal(refused.thread?.problems[setId], "The change set changed since you saw it.");
});

test("Reject leaves Needs you only if nothing else in the thread needs the user", () => {
  // Rejected, the thread waits on the user's next message, as any working
  // thread with nothing to decide does: it stays, as Your turn.
  const rejecting = click(onPage(), "reject");
  assert.deepEqual(waiting(rejecting), [id, other]);
  assert.equal(nav(rejecting).waiting[0]?.waitingOn, "reply");
  const set = expected(rejecting.thread as ThreadModel)?.changeSets[0];
  assert.deepEqual([set?.status, set?.nextSteps], ["rejected", []]);
  // With a second change set still open, it still needs a review.
  const both = click(onPage([open(setId), open(secondSet)]), "reject");
  assert.equal(nav(both).waiting[0]?.waitingOn, "review");
  // Approving one while another waits keeps it in Needs you too.
  const approvingOne = click(onPage([open(setId), open(secondSet)]), "approve");
  assert.deepEqual(waiting(approvingOne), [id, other]);
});

test("once the server shows the decision, its view stands", () => {
  const model = click(onPage(), "approve");
  const thread = model.thread as ThreadModel;
  const [reloaded] = threadReplied(
    thread,
    replied(
      { kind: "thread", id },
      viewWith([
        {
          ...open(setId),
          status: "stopped",
          nextSteps: [{ kind: "retry" }],
          decision: { kind: "approved", via: "thread", by: "user", at },
        },
      ]),
    ),
  );
  assert.equal(expected(reloaded)?.changeSets[0]?.status, "stopped");
});

test("a click the page refuses expects nothing", () => {
  const model = onPage();
  // Not offered: retry isn't a step of an open change set.
  const [same] = update(model, {
    type: "thread",
    msg: { type: "changeSetClicked", changeSetId: setId, step: "retry" },
  });
  assert.deepEqual(same.thread?.deciding, {});
  assert.deepEqual(waiting(same), [id, other]);
});
