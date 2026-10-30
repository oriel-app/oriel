import assert from "node:assert/strict";
import { test } from "node:test";
import { groupReplied, initGroup, updateGroup } from "../src/group.ts";
import type { Effect, Replied } from "../src/http.ts";
import { initReview, reviewReplied, reviewSteps, updateReview } from "../src/review.ts";
import { init as initRoot, update as updateRoot } from "../src/root.ts";
import { parseRoute, routeUrl, safeHref } from "../src/route.ts";
import {
  blocks,
  initThread,
  removable,
  stepLabel,
  streamed,
  type ThreadModel,
  threadReplied,
  updateThread,
} from "../src/thread.ts";
import { init, pickedName, update } from "../src/update.ts";
import type {
  ChangeSetView,
  ChatEntry,
  DiffView,
  GroupView,
  NextStepView,
  ReviewView,
  ThreadView,
  WindowView,
} from "../src/view.ts";

const id = "01JBZ0000000000000000000T1";
const groupId = "01JBZ0000000000000000000G1";
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

test("routes read from and write to the address bar", () => {
  const routes = [
    { page: "window", grouping: "stuck", addTo: null },
    { page: "window", grouping: "epic", addTo: groupId },
    { page: "group", id: groupId },
    { page: "thread", id },
    { page: "inbox" },
    { page: "review", token: "abc_DEF-123" },
  ] as const;
  for (const route of routes) {
    const url = new URL(routeUrl(route), "http://127.0.0.1:4310");
    assert.deepEqual(parseRoute(url.pathname, url.search), route);
  }
  assert.deepEqual(parseRoute("/nonsense", "?grouping=x&addTo=../x"), {
    page: "window",
    grouping: "epic",
    addTo: null,
  });
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

function windowView(): WindowView {
  const row = (key: string) => ({
    id: `jira:${key}`,
    key,
    title: `Title ${key}`,
    type: "Story",
    status: null,
    assignee: null,
    points: null,
    idleDays: 0,
  });
  return {
    grouping: "epic",
    clusters: [
      {
        row: {
          key: "10001",
          label: "Checkout",
          origin: { kind: "source", source: "Jira" },
          anchor: null,
          count: 2,
          points: 0,
          estimated: 0,
          unestimated: 2,
          status: { todo: 2, "in-progress": 0, done: 0 },
        },
        list: [row("SYN-10"), row("SYN-11")],
      },
    ],
    items: 2,
    asOf: at,
    fixture: true,
  };
}

function shownWindow() {
  const [model] = init("epic");
  return update(model, { type: "windowLoaded", request: model.request, window: windowView() })[0];
}

test("picking items, then making a group of them, goes to the new group", () => {
  let model = shownWindow();
  model = update(model, { type: "itemToggled", id: "jira:SYN-10" })[0];
  model = update(model, { type: "itemToggled", id: "jira:SYN-11" })[0];
  assert.deepEqual(model.selected, ["jira:SYN-10", "jira:SYN-11"]);
  assert.equal(pickedName(model), "Checkout");
  const [pending, effects] = update(model, { type: "selectionGrouped", name: "Checkout" });
  assert.deepEqual(effects, [
    {
      type: "http",
      method: "POST",
      url: "/api/groups",
      body: { kind: "picked", name: "Checkout", items: ["jira:SYN-10", "jira:SYN-11"] },
      tag: { kind: "createGroup" },
    },
  ]);
  // A second click while it's pending does nothing.
  assert.deepEqual(update(pending, { type: "selectionGrouped", name: "x" })[1], []);
  const [made, next] = update(pending, ok({ kind: "createGroup" }, { id: groupId }));
  assert.deepEqual(made.selected, []);
  assert.deepEqual(next, [{ type: "navigate", route: { page: "group", id: groupId } }]);
  const [refused] = update(
    pending,
    failed({ kind: "createGroup" }, "jira:SYN-11 isn't in the window"),
  );
  assert.deepEqual([refused.pending, refused.notice], [false, "jira:SYN-11 isn't in the window"]);
  assert.deepEqual(refused.selected, ["jira:SYN-10", "jira:SYN-11"]);
});

test("a cluster becomes a group in one click; picked items can join an existing group", () => {
  const model = shownWindow();
  assert.deepEqual(update(model, { type: "clusterGrouped", key: "10001" })[1], [
    {
      type: "http",
      method: "POST",
      url: "/api/groups",
      body: { kind: "cluster", grouping: "epic", cluster: "10001" },
      tag: { kind: "createGroup" },
    },
  ]);
  const picked = update(model, { type: "itemToggled", id: "jira:SYN-10" })[0];
  const [, effects] = update(picked, { type: "selectionAdded", groupId });
  assert.deepEqual(effects, [
    {
      type: "http",
      method: "POST",
      url: `/api/groups/${groupId}/add`,
      body: { items: ["jira:SYN-10"] },
      tag: { kind: "addToGroup", groupId },
    },
  ]);
  assert.deepEqual(update(model, { type: "selectionAdded", groupId })[1], []);
  assert.deepEqual(update(picked, { type: "selectionCleared" })[0].selected, []);
});

function threadView(entries: ChatEntry[], changeSets: ChangeSetView[] = []): ThreadView {
  return {
    id,
    title: "Hi",
    group: { id: groupId, name: "Checkout", version: 1 },
    state: "working",
    doneBy: null,
    regionVersion: 1,
    members: [],
    entries,
    lastSeq: entries.at(-1)?.seq ?? 0,
    running: false,
    changeSets,
    writable: false,
  };
}

const openSet: ChangeSetView = {
  id: setId,
  status: "open",
  nextSteps: [{ kind: "approve" }, { kind: "reject" }, { kind: "remove", mutationIds: ["m1"] }],
  applying: false,
  sentUnapplied: false,
  decision: null,
  errors: [],
  revertOf: null,
  reverts: [],
  createdAt: at,
};

const diff: DiffView = { changeSetId: setId, hash: "h1", lines: [] };

function loadedThread(view: ThreadView): [ThreadModel, Effect[]] {
  const [model] = initThread(id);
  return threadReplied(model, ok({ kind: "thread", id }, view));
}

test("a thread loads, then watches its events from the last entry, and diffs its change sets", () => {
  assert.deepEqual(initThread(id)[1], [
    { type: "http", method: "GET", url: `/api/threads/${id}`, tag: { kind: "thread", id } },
  ]);
  const [model, effects] = loadedThread(
    threadView(
      [
        { seq: 1, at, kind: "user", text: "Hi" },
        { seq: 2, at, kind: "change-set", changeSetId: setId },
      ],
      [openSet],
    ),
  );
  assert.equal(model.status, "ready");
  assert.deepEqual(effects, [
    { type: "subscribe", threadId: id, after: 2 },
    {
      type: "http",
      method: "POST",
      url: `/api/change-sets/${setId}/diff`,
      body: {},
      tag: { kind: "diff", changeSetId: setId },
    },
  ]);
});

test("streamed entries append once, and a new change set fetches its diff", () => {
  const [model] = loadedThread(threadView([{ seq: 1, at, kind: "user", text: "Hi" }]));
  const text = {
    type: "entry" as const,
    entry: { seq: 2, at, kind: "text" as const, text: "Hello" },
  };
  const [once] = streamed(model, text);
  assert.equal(once.view?.entries.length, 2);
  assert.equal(streamed(once, text)[0], once);
  const [, effects] = streamed(once, {
    type: "entry",
    entry: { seq: 3, at, kind: "change-set", changeSetId: setId },
  });
  assert.deepEqual(
    effects.map((e) => (e.type === "http" ? e.url : e.type)),
    [`/api/change-sets/${setId}/diff`, `/api/threads/${id}`],
  );
  const [finished, after] = streamed(
    { ...once, view: once.view && { ...once.view, running: true } },
    { type: "status", running: false, state: "working", regionVersion: 1 },
  );
  assert.equal(finished.view?.running, false);
  assert.deepEqual(
    after.map((e) => e.type),
    ["http"],
  );
});

test("an apply reloads each tab twice and diffs once: as it starts, then as it ends", () => {
  const [loaded] = loadedThread(threadView([], [openSet]));
  const urls = (effects: Effect[]) => effects.map((e) => (e.type === "http" ? e.url : e.type));
  // The tab that approved: its own reply adds nothing, the stream says it all.
  const [approving, approve] = threadReplied(
    loaded,
    ok(
      { kind: "changeSet", threadId: id, changeSetId: setId },
      { changeSet: openSet, report: null },
    ),
  );
  assert.deepEqual(approve, []);
  const [starting, started] = streamed(approving, {
    type: "change-set",
    changeSetId: setId,
    applying: true,
  });
  assert.equal(starting, approving);
  assert.deepEqual(urls(started), [`/api/threads/${id}`]);
  // As it ends: one diff, then the thread once that diff is recorded, so the
  // steps it offers count it.
  const [, ended] = streamed(starting, { type: "change-set", changeSetId: setId, applying: false });
  assert.deepEqual(urls(ended), [`/api/change-sets/${setId}/diff`]);
  assert.deepEqual(
    urls(threadReplied(starting, ok({ kind: "diff", changeSetId: setId }, diff))[1]),
    [`/api/threads/${id}`],
  );
});

test("a stream that reconnects reloads the thread once, and diffs what was applying", () => {
  const [model] = initRoot({ page: "thread", id });
  const [loaded] = updateRoot(model, {
    type: "replied",
    tag: { kind: "thread", id },
    ok: true,
    body: threadView([], [{ ...openSet, status: "applying", applying: true, nextSteps: [] }]),
  });
  const [, effects] = updateRoot(loaded, { type: "streamReopened" });
  assert.deepEqual(
    effects.map((e) => (e.type === "http" ? e.url : e.type)),
    [`/api/threads/${id}`, `/api/change-sets/${setId}/diff`, "/api/threads"],
  );
});

test("approving sends the hash of the diff on screen; a refusal shows on the change set", () => {
  const [loaded] = loadedThread(
    threadView([{ seq: 1, at, kind: "change-set", changeSetId: setId }], [openSet]),
  );
  // No diff yet: nothing to approve.
  assert.deepEqual(
    updateThread(loaded, { type: "changeSetClicked", changeSetId: setId, step: "approve" })[1],
    [],
  );
  // A diff on screen is what approving waits on, so the thread reloads.
  const [withDiff, reload] = threadReplied(loaded, ok({ kind: "diff", changeSetId: setId }, diff));
  assert.deepEqual(reload, [
    { type: "http", method: "GET", url: `/api/threads/${id}`, tag: { kind: "thread", id } },
  ]);
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
  const [refused, again] = threadReplied(
    busy,
    failed(
      { kind: "changeSet", threadId: id, changeSetId: setId },
      "Writing to Jira isn't configured here.",
    ),
  );
  assert.deepEqual(refused.busy, []);
  assert.equal(refused.problems[setId], "Writing to Jira isn't configured here.");
  assert.equal(again.length, 2);
  const [, removing] = updateThread(withDiff, {
    type: "lineRemoved",
    changeSetId: setId,
    mutationId: "m1",
  });
  assert.deepEqual(removing[0], {
    type: "http",
    method: "POST",
    url: `/api/change-sets/${setId}/edit`,
    body: { remove: ["m1"] },
    tag: { kind: "changeSet", threadId: id, changeSetId: setId },
  });
});

test("sending a message clears the draft once the server takes it", () => {
  const [loaded] = loadedThread(threadView([]));
  const drafted = updateThread(loaded, { type: "draftChanged", text: "  What's left?  " })[0];
  const [sending, effects] = updateThread(drafted, { type: "sendClicked" });
  assert.deepEqual(effects[0], {
    type: "http",
    method: "POST",
    url: `/api/threads/${id}/messages`,
    body: { text: "What's left?" },
    tag: { kind: "sent", threadId: id },
  });
  assert.deepEqual(updateThread(sending, { type: "sendClicked" })[1], []);
  const [sent] = threadReplied(sending, ok({ kind: "sent", threadId: id }, { seq: 1 }));
  assert.deepEqual([sent.draft, sent.sending], ["", false]);
});

test("the chat joins a streamed reply and a run's start and finish into one block each", () => {
  const run = {
    outcome: "ok" as const,
    wallMs: 4,
    reads: [],
    mutations: 0,
    logs: [],
    returned: "3",
    error: null,
  };
  const out = blocks([
    { seq: 1, at, kind: "user", text: "Hi" },
    { seq: 2, at, kind: "text", text: "Let me " },
    { seq: 3, at, kind: "text", text: "look." },
    { seq: 4, at, kind: "run.started", runId: "r1", script: "return 3;" },
    { seq: 5, at, kind: "run.finished", runId: "r1", run },
    { seq: 6, at, kind: "text", text: "Three." },
    { seq: 7, at, kind: "done" },
    { seq: 8, at, kind: "error", message: "Stopped." },
  ]);
  assert.deepEqual(out, [
    { kind: "user", seq: 1, text: "Hi" },
    { kind: "reply", seq: 2, text: "Let me look." },
    { kind: "run", seq: 4, runId: "r1", script: "return 3;", run, stopped: false },
    { kind: "reply", seq: 6, text: "Three." },
    { kind: "notice", seq: 8, tone: "error", text: "Stopped." },
  ]);
});

// Partly applied, stopped at a change that was sent without an answer.
const stoppedSet: ChangeSetView = {
  ...openSet,
  status: "partial",
  sentUnapplied: true,
  errors: [{ mutationId: "m2", error: "This may already be in Jira.", sent: true }],
  nextSteps: [
    { kind: "retry" },
    { kind: "remove", mutationIds: ["m2"] },
    { kind: "dismiss", warnings: ["This may already be in Jira: check SYN-12"] },
  ],
};

test("only what the change set engine offers is sent", () => {
  const [loaded] = loadedThread(threadView([], [stoppedSet]));
  const [shown] = threadReplied(loaded, ok({ kind: "diff", changeSetId: setId }, diff));
  const click = (step: Exclude<NextStepView["kind"], "remove">) =>
    updateThread(shown, { type: "changeSetClicked", changeSetId: setId, step })[1];
  // Not offered, so not sent, whatever the window might show.
  assert.deepEqual(click("approve"), []);
  assert.deepEqual(click("revert"), []);
  assert.deepEqual(
    updateThread(shown, { type: "lineRemoved", changeSetId: setId, mutationId: "m1" })[1],
    [],
  );
  assert.deepEqual(
    [...click("retry"), ...click("dismiss")].map((e) => (e.type === "http" ? e.url : e.type)),
    [`/api/change-sets/${setId}/apply`, `/api/change-sets/${setId}/dismiss`],
  );
  assert.deepEqual(removable(shown, setId), ["m2"]);
});

test("dismissing keeps what it says to check", () => {
  const [loaded] = loadedThread(threadView([], [stoppedSet]));
  const [dismissed] = threadReplied(
    loaded,
    ok(
      { kind: "changeSet", threadId: id, changeSetId: setId },
      {
        changeSet: { ...stoppedSet, nextSteps: [] },
        warnings: ["This may already be in Jira: check SYN-12"],
      },
    ),
  );
  assert.deepEqual(dismissed.notes[setId], ["This may already be in Jira: check SYN-12"]);
});

test("each offered step has a name for where the change set stands", () => {
  assert.equal(stepLabel("retry", stoppedSet), "Try again");
  assert.equal(stepLabel("retry", { ...openSet, status: "approved" }), "Apply");
  assert.equal(stepLabel("revert", stoppedSet), "Revert what was applied");
  assert.equal(stepLabel("revert", { ...openSet, status: "applied" }), "Revert");
  assert.equal(stepLabel("approve-rest", stoppedSet), "Approve the rest");
});

test("a stopped change is left out with an edit, and the thread's stream reloads it", () => {
  const [loaded] = loadedThread(threadView([], [stoppedSet]));
  const [busy, effects] = updateThread(loaded, {
    type: "lineRemoved",
    changeSetId: setId,
    mutationId: "m2",
  });
  assert.deepEqual(effects, [
    {
      type: "http",
      method: "POST",
      url: `/api/change-sets/${setId}/edit`,
      body: { remove: ["m2"] },
      tag: { kind: "changeSet", threadId: id, changeSetId: setId },
    },
  ]);
  // The reply adds nothing: the server tells the stream, which diffs it,
  // then reloads the thread.
  const [edited, after] = threadReplied(
    busy,
    ok({ kind: "changeSet", threadId: id, changeSetId: setId }, { changeSet: openSet }),
  );
  assert.deepEqual(after, []);
  const [, told] = streamed(edited, { type: "change-set", changeSetId: setId, applying: false });
  assert.deepEqual(
    told.map((e) => (e.type === "http" ? `${e.method} ${e.url}` : e.type)),
    [`POST /api/change-sets/${setId}/diff`],
  );
});

test("a problem the server reports alongside a decision shows on the change set", () => {
  const [loaded] = loadedThread(threadView([], [openSet]));
  const [shown] = threadReplied(
    loaded,
    ok(
      { kind: "changeSet", threadId: id, changeSetId: setId },
      { changeSet: { ...openSet, status: "approved" }, problem: "busy" },
    ),
  );
  assert.equal(shown.problems[setId], "busy");
});

test("a run its turn never finished shows as stopped once the turn ends", () => {
  const started = { seq: 1, at, kind: "run.started" as const, runId: "r1", script: "x" };
  const [running] = blocks([started]);
  assert.equal(running?.kind === "run" && running.stopped, false);
  const [stopped] = blocks([started, { seq: 2, at, kind: "done" }]);
  assert.equal(stopped?.kind === "run" && stopped.stopped, true);
});

test("asking on a group's page opens a thread and goes to it", () => {
  const [model, effects] = initGroup(groupId);
  assert.deepEqual(effects, [
    {
      type: "http",
      method: "GET",
      url: `/api/groups/${groupId}`,
      tag: { kind: "group", id: groupId },
    },
  ]);
  const drafted = updateGroup(model, { type: "draftChanged", text: "What's stuck?" })[0];
  const [pending, ask] = updateGroup(drafted, { type: "askClicked" });
  assert.deepEqual(ask, [
    {
      type: "http",
      method: "POST",
      url: `/api/groups/${groupId}/threads`,
      body: { text: "What's stuck?" },
      tag: { kind: "threadOpened", groupId },
    },
  ]);
  const [, go] = groupReplied(pending, ok({ kind: "threadOpened", groupId }, { id }));
  assert.deepEqual(go, [{ type: "navigate", route: { page: "thread", id } }]);
  assert.deepEqual(updateGroup(model, { type: "memberRemoved", id: "jira:SYN-3" })[1], [
    {
      type: "http",
      method: "POST",
      url: `/api/groups/${groupId}/remove`,
      body: { items: ["jira:SYN-3"] },
      tag: { kind: "groupChanged", id: groupId },
    },
  ]);
  assert.deepEqual(updateGroup(model, { type: "addClicked" })[1], [
    { type: "navigate", route: { page: "window", grouping: "epic", addTo: groupId } },
  ]);
});

test("a group is renamed only when the name changed", () => {
  const view = { group: { name: "Checkout" } } as GroupView;
  const [model] = groupReplied(initGroup(groupId)[0], ok({ kind: "group", id: groupId }, view));
  const same = updateGroup(model, { type: "nameEdited", name: " Checkout " })[0];
  assert.deepEqual(updateGroup(same, { type: "nameSaved" })[1], []);
  const changed = updateGroup(model, { type: "nameEdited", name: "Checkout v2" })[0];
  assert.deepEqual(updateGroup(changed, { type: "nameSaved" })[1], [
    {
      type: "http",
      method: "POST",
      url: `/api/groups/${groupId}/rename`,
      body: { name: "Checkout v2" },
      tag: { kind: "renamed", id: groupId },
    },
  ]);
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
  assert.deepEqual([nameless.problem, none], ["Type your name first.", []]);
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
  const [dead] = reviewReplied(
    opening,
    failed({ kind: "reviewOpened" }, "This review link has expired"),
  );
  assert.equal(dead.stage, "dead");
});

test("a partly applied change set's review link offers what the engine offers it", () => {
  const warning = "This may already be in Jira: check SYN-12";
  const partial: ChangeSetView = {
    ...openSet,
    status: "partial",
    nextSteps: [
      { kind: "approve-rest" },
      { kind: "remove", mutationIds: ["m2"] },
      { kind: "dismiss", warnings: [warning] },
      { kind: "revert" },
    ],
  };
  const [opening] = updateReview(initReview("tok")[0], { type: "openClicked" });
  const [shown] = reviewReplied(
    opening,
    ok({ kind: "reviewOpened" }, { changeSet: partial, diff }),
  );
  assert.ok(shown.view);
  // Only what a link can do: no remove, no revert, and no reject.
  assert.deepEqual(reviewSteps(shown.view), ["approve-rest", "dismiss"]);
  const named = updateReview(shown, { type: "nameChanged", name: "Ana" })[0];
  assert.deepEqual(updateReview(named, { type: "decideClicked", kind: "rejected" })[1], []);
  assert.deepEqual(updateReview(named, { type: "decideClicked", kind: "approved" })[1], [
    {
      type: "http",
      method: "POST",
      url: "/api/review/decide",
      body: { token: "tok", changeSet: setId, kind: "approved", name: "Ana", hash: "h1" },
      tag: { kind: "reviewDecided" },
    },
  ]);
  const [dismissing, effects] = updateReview(named, { type: "dismissClicked" });
  assert.deepEqual(effects, [
    {
      type: "http",
      method: "POST",
      url: "/api/review/dismiss",
      body: { token: "tok", changeSet: setId, name: "Ana", hash: "h1" },
      tag: { kind: "reviewDecided" },
    },
  ]);
  const [dismissed] = reviewReplied(
    dismissing,
    ok(
      { kind: "reviewDecided" },
      {
        changeSet: {
          ...partial,
          nextSteps: [{ kind: "revert" }],
          decision: { kind: "rejected", via: "review-link", by: "Ana", at },
        },
        warnings: [warning],
      },
    ),
  );
  assert.deepEqual([dismissed.stage, dismissed.outcome], ["decided", "dismissed"]);
  assert.deepEqual(dismissed.warnings, [warning]);
});

test("leaving a thread stops watching it; the window keeps what was picked", () => {
  const [model] = initRoot({ page: "window", grouping: "epic", addTo: null });
  const picked = updateRoot(model, {
    type: "window",
    msg: { type: "itemToggled", id: "jira:SYN-10" },
  })[0];
  const [inThread, enter] = updateRoot(picked, { type: "routed", route: { page: "thread", id } });
  assert.ok(enter.some((e) => e.type === "http" && e.url === `/api/threads/${id}`));
  const [back, leave] = updateRoot(inThread, {
    type: "routed",
    route: { page: "window", grouping: "epic", addTo: null },
  });
  assert.deepEqual(leave[0], { type: "unsubscribe" });
  assert.deepEqual(back.window?.selected, ["jira:SYN-10"]);
  const [, review] = updateRoot(model, { type: "routed", route: { page: "review", token: "tok" } });
  assert.deepEqual(review, []);
});

test("going back to a thread, or following its link again, watches it again", () => {
  const [model] = initRoot({ page: "thread", id });
  const view = threadView([{ seq: 1, at, kind: "user", text: "Hi" }]);
  const load = (current: typeof model) =>
    updateRoot(current, { type: "replied", tag: { kind: "thread", id }, ok: true, body: view });
  const [watching, first] = load(model);
  assert.deepEqual(first[0], { type: "subscribe", threadId: id, after: 1 });
  // Away to the window, then Back.
  const [away, leave] = updateRoot(watching, {
    type: "routed",
    route: { page: "window", grouping: "epic", addTo: null },
  });
  assert.deepEqual(leave[0], { type: "unsubscribe" });
  assert.equal(away.thread, null);
  const [back, enter] = updateRoot(away, { type: "routed", route: { page: "thread", id } });
  assert.ok(enter.some((e) => e.type === "http" && e.url === `/api/threads/${id}`));
  const [again, resubscribe] = load(back);
  assert.deepEqual(resubscribe[0], { type: "subscribe", threadId: id, after: 1 });
  // Live events land again.
  const [live] = updateRoot(again, {
    type: "streamed",
    event: { type: "entry", entry: { seq: 2, at, kind: "text", text: "Hello" } },
  });
  assert.equal(live.thread?.view?.entries.length, 2);
  // The same link while on the page: stop, reload, watch again.
  const [, same] = updateRoot(again, { type: "routed", route: { page: "thread", id } });
  assert.deepEqual(same.map((e) => (e.type === "http" ? e.url : e.type)).slice(0, 2), [
    "unsubscribe",
    `/api/threads/${id}`,
  ]);
});

test("the window reports a grouping switch and a zoom in or out, and nothing else", () => {
  const [model] = initRoot({ page: "window", grouping: "epic", addTo: null });
  const shown = updateRoot(model, {
    type: "window",
    msg: { type: "windowLoaded", request: model.window?.request ?? 0, window: windowView() },
  })[0];
  const reported = (msg: Parameters<typeof update>[1]) =>
    updateRoot(shown, { type: "window", msg })[1].flatMap((e) =>
      e.type === "http" && e.url === "/api/telemetry" ? [e.body] : [],
    );
  assert.deepEqual(reported({ type: "groupingPicked", grouping: "stuck" }), [
    { name: "grouping.switched", grouping: "stuck" },
  ]);
  assert.deepEqual(reported({ type: "clusterToggled", key: "10001" }), [
    { name: "zoom.changed", from: "cluster", to: "list" },
  ]);
  const opened = updateRoot(shown, {
    type: "window",
    msg: { type: "clusterToggled", key: "10001" },
  })[0];
  assert.deepEqual(
    updateRoot(opened, { type: "window", msg: { type: "clusterToggled", key: "10001" } })[1].map(
      (e) => (e.type === "http" ? e.body : e.type),
    ),
    [{ name: "zoom.changed", from: "list", to: "cluster" }],
  );
  assert.deepEqual(reported({ type: "itemToggled", id: "jira:SYN-10" }), []);
});
