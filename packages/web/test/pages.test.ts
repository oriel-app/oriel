import assert from "node:assert/strict";
import { test } from "node:test";
import type { Effect, Replied } from "../src/http.ts";
import { initReview, reviewReplied, reviewSteps, updateReview } from "../src/review.ts";
import { safeHref } from "../src/route.ts";
import { initThread, type ThreadModel, threadReplied, updateThread } from "../src/thread.ts";
import type { ChangeSetView, ChatEntry, ReviewView, ThreadView } from "../src/view.ts";
import { changeSetView, diffView, threadView } from "../testing.ts";

const id = "01JBZ0000000000000000000T1";
const workstreamId = "01JBZ0000000000000000000G1";
const setId = "01JBZ0000000000000000000C1";
const at = "2026-10-29T09:00:00.000Z";

const ok = (tag: Replied["tag"], body: unknown): Replied => ({
  type: "replied",
  tag,
  ok: true,
  body,
});
const failed = (tag: Replied["tag"], error: string): Replied => ({
  type: "replied",
  tag,
  ok: false,
  body: { error },
});

test("only http(s) URLs become links", () => {
  assert.equal(
    safeHref("https://oriel.atlassian.net/browse/SYN-1"),
    "https://oriel.atlassian.net/browse/SYN-1",
  );
  for (const url of [
    null,
    "javascript:alert(1)",
    "file:///etc/passwd",
    "data:text/html,x",
    "//evil",
  ])
    assert.equal(safeHref(url), undefined, String(url));
});

const thread = (entries: ChatEntry[], changeSets: ChangeSetView[] = []): ThreadView =>
  threadView({
    id,
    title: "Hi",
    workstream: { id: workstreamId, name: "Checkout", version: 1 },
    state: "working",
    regionVersion: 1,
    entries,
    lastSeq: entries.at(-1)?.seq ?? 0,
    running: false,
    changeSets,
    writable: false,
  });

const openSet = changeSetView({
  id: setId,
  status: "open",
  nextSteps: [{ kind: "approve" }, { kind: "reject" }, { kind: "remove", mutationIds: ["m1"] }],
  decision: null,
  errors: [],
});

const diff = diffView({ changeSetId: setId, hash: "h1" });

function loadedThread(view: ThreadView): [ThreadModel, Effect[]] {
  const [model] = initThread(id);
  return threadReplied(model, ok({ kind: "thread", id }, view));
}

test("approving sends the hash of the diff on screen; a refusal shows on the change set", () => {
  const [loaded] = loadedThread(
    thread([{ seq: 1, at, kind: "change-set", changeSetId: setId }], [openSet]),
  );
  // No diff yet: nothing to approve.
  assert.deepEqual(
    updateThread(loaded, { type: "changeSetClicked", changeSetId: setId, step: "approve" })[1],
    [],
  );
  const [withDiff] = threadReplied(loaded, ok({ kind: "diff", changeSetId: setId }, diff));
  const [busy, effects] = updateThread(withDiff, {
    type: "changeSetClicked",
    changeSetId: setId,
    step: "approve",
  });
  assert.deepEqual(effects, [
    {
      type: "http",
      method: "POST",
      url: `/api/change-sets/${setId}/approve`,
      body: { hash: "h1" },
      tag: { kind: "changeSet", threadId: id, changeSetId: setId },
    },
  ]);
  assert.deepEqual(busy.busy, [setId]);
  const [refused] = threadReplied(
    busy,
    failed({ kind: "changeSet", threadId: id, changeSetId: setId }, "refused"),
  );
  assert.deepEqual(refused.busy, []);
  assert.ok(refused.problems[setId]);
});

test("a message's draft stays until the server takes it, and is sent once", () => {
  const [loaded] = loadedThread(thread([]));
  const drafted = updateThread(loaded, { type: "draftChanged", text: "  What's left?  " })[0];
  const [sending, effects] = updateThread(drafted, { type: "sendClicked" });
  assert.equal(effects.length, 1);
  assert.equal(sending.draft, drafted.draft);
  assert.deepEqual(updateThread(sending, { type: "sendClicked" })[1], []);
  const [refused] = threadReplied(sending, failed({ kind: "sent", threadId: id }, "down"));
  assert.deepEqual([refused.draft, refused.sending], [drafted.draft, false]);
  const [sent] = threadReplied(sending, ok({ kind: "sent", threadId: id }, { seq: 1 }));
  assert.deepEqual([sent.draft, sent.sending], ["", false]);
});

test("a review link opens nothing on load; the person asks, then decides with their name", () => {
  const [model, effects] = initReview("tok");
  assert.deepEqual(effects, []);
  const [opening, open] = updateReview(model, { type: "openClicked" });
  assert.deepEqual(open, [
    {
      type: "http",
      method: "POST",
      url: "/api/review/open",
      body: { token: "tok" },
      tag: { kind: "reviewOpened" },
    },
  ]);
  const review: ReviewView = { changeSet: openSet, diff };
  const [shown] = reviewReplied(opening, ok({ kind: "reviewOpened" }, review));
  const [nameless, none] = updateReview(shown, { type: "decideClicked", kind: "approved" });
  assert.ok(nameless.problem);
  assert.deepEqual(none, []);
  const named = updateReview(shown, { type: "nameChanged", name: " Ana " })[0];
  assert.deepEqual(updateReview(named, { type: "decideClicked", kind: "approved" })[1], [
    {
      type: "http",
      method: "POST",
      url: "/api/review/decide",
      body: { token: "tok", changeSet: setId, kind: "approved", name: "Ana", hash: "h1" },
      tag: { kind: "reviewDecided" },
    },
  ]);
  const [dead] = reviewReplied(opening, failed({ kind: "reviewOpened" }, "expired"));
  assert.equal(dead.stage, "dead");
});

test("a partly applied change set's review link offers only what a link can do", () => {
  const partial: ChangeSetView = {
    ...openSet,
    status: "partial",
    nextSteps: [
      { kind: "approve-rest" },
      { kind: "remove", mutationIds: ["m2"] },
      { kind: "dismiss", warnings: ["check SYN-12"] },
      { kind: "revert" },
    ],
  };
  const [opening] = updateReview(initReview("tok")[0], { type: "openClicked" });
  const [shown] = reviewReplied(
    opening,
    ok({ kind: "reviewOpened" }, { changeSet: partial, diff }),
  );
  assert.ok(shown.view);
  // No remove, no revert, and no reject.
  assert.deepEqual(reviewSteps(shown.view), ["approve-rest", "dismiss"]);
  const named = updateReview(shown, { type: "nameChanged", name: "Ana" })[0];
  assert.deepEqual(updateReview(named, { type: "decideClicked", kind: "rejected" })[1], []);
  assert.deepEqual(updateReview(named, { type: "dismissClicked" })[1], [
    {
      type: "http",
      method: "POST",
      url: "/api/review/dismiss",
      body: { token: "tok", changeSet: setId, name: "Ana", hash: "h1" },
      tag: { kind: "reviewDecided" },
    },
  ]);
});
