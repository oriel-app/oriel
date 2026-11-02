// Finding your way back to a thread (OA-108, OA-110): the sidebar's search,
// a thread's address that names a change set, and a reply's link to one.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Effect } from "../src/http.ts";
import { parse } from "../src/markdown.ts";
import { init, type Model, type Msg, update } from "../src/root.ts";
import { inAppRoute, parseRoute, routeUrl } from "../src/route.ts";
import { initSearch, pauseMs, type SearchMsg } from "../src/search.ts";
import type { ChangeSetView, SearchResultView, SearchView, ThreadView } from "../src/view.ts";

const threadId = "01JBZ0000000000000000000T1";
const setId = "01JBZ0000000000000000000C1";
const other = "01JBZ0000000000000000000C2";
const at = "2026-01-01T00:00:00.000Z";

const search = (msg: SearchMsg): Msg => ({ type: "search", msg });

function run(model: Model, ...msgs: Msg[]): [Model, Effect[]] {
  let effects: Effect[] = [];
  for (const msg of msgs) [model, effects] = update(model, msg);
  return [model, effects];
}

const result = (changeSet: string | null): SearchResultView => ({
  thread: {
    id: threadId,
    title: "Try a Slack post",
    state: "done",
    workstream: { id: "01JBZ0000000000000000000G1", name: "SMS updates" },
  },
  changeSet: changeSet === null ? null : { id: changeSet, state: "applied" },
  matched: changeSet ? "change-set" : "name",
  excerpt: "Test post from Oriel",
});

const answered = (request: number, results: SearchResultView[]): Msg => ({
  type: "replied",
  tag: { kind: "search", request },
  ok: true,
  body: { query: "test post", results } satisfies SearchView,
});

const reports = (effects: readonly Effect[]) =>
  effects.flatMap((e) => (e.type === "http" && e.tag.kind === "telemetry" ? [e.body] : []));

test("typing asks the server once it pauses, about the latest query only", () => {
  const [start] = init({ page: "done" });
  const [typed, effects] = run(
    start,
    search({ type: "typed", text: "test" }),
    search({ type: "typed", text: "test post" }),
  );
  assert.deepEqual(effects, [
    { type: "after", ms: pauseMs, msg: search({ type: "paused", request: 2 }) },
  ]);
  // The pause after "test" had ended before the last keystroke.
  assert.deepEqual(update(typed, search({ type: "paused", request: 1 }))[1], []);
  const [, asked] = update(typed, search({ type: "paused", request: 2 }));
  assert.deepEqual(asked, [
    {
      type: "http",
      method: "GET",
      url: "/api/search?q=test+post",
      tag: { kind: "search", request: 2 },
    },
  ]);
});

test("the results replace what showed, and the search is counted without its text", () => {
  const [start] = init({ page: "done" });
  const [typed] = run(start, search({ type: "typed", text: " test post " }));
  // A reply to an earlier query is dropped.
  assert.equal(update(typed, answered(0, [result(setId)]))[0].search.results, null);
  const [shown, effects] = update(typed, answered(1, [result(setId), result(null)]));
  assert.equal(shown.search.results?.length, 2);
  assert.deepEqual(reports(effects), [{ name: "threads.searched", queryLength: 9, results: 2 }]);
});

test("the arrow keys move through the results, and Enter opens the thread at the change set", () => {
  const [start] = init({ page: "done" });
  const [shown] = run(
    start,
    search({ type: "typed", text: "test post" }),
    answered(1, [result(null), result(setId)]),
    search({ type: "moved", by: 1 }),
    search({ type: "moved", by: 1 }),
  );
  assert.equal(shown.search.active, 1);
  assert.equal(update(shown, search({ type: "moved", by: -1 }))[0].search.active, 0);
  const [opened, effects] = update(shown, search({ type: "entered" }));
  assert.deepEqual(effects[0], {
    type: "navigate",
    route: { page: "thread", id: threadId, changeSet: setId },
  });
  assert.deepEqual(reports(effects), [
    { name: "threads.search-opened", opened: "change-set", rank: 2 },
  ]);
  // Opening one clears the field, so the lists show again.
  assert.equal(opened.search.query, "");
  assert.equal(opened.search.results, null);
});

test("a click opens the result it is on; one on the thread opens the thread", () => {
  const [start] = init({ page: "done" });
  const [shown] = run(start, search({ type: "typed", text: "slack" }), answered(1, [result(null)]));
  const [, effects] = update(shown, search({ type: "picked", index: 0 }));
  assert.deepEqual(effects[0], { type: "navigate", route: { page: "thread", id: threadId } });
  assert.deepEqual(reports(effects), [
    { name: "threads.search-opened", opened: "thread", rank: 1 },
  ]);
  // Nothing to open, nothing done.
  assert.deepEqual(update(start, search({ type: "entered" }))[1], []);
});

test("Escape clears the field, and a reply still on its way is dropped", () => {
  const [start] = init({ page: "done" });
  const [cleared] = run(
    start,
    search({ type: "typed", text: "slack" }),
    search({ type: "cleared" }),
  );
  assert.deepEqual({ ...cleared.search, request: 0 }, initSearch());
  assert.equal(update(cleared, answered(1, [result(null)]))[0].search.results, null);
  // Emptying the field by hand asks nothing.
  assert.deepEqual(run(start, search({ type: "typed", text: "  " }))[1], []);
});

test("a thread's address may name one of its change sets", () => {
  const route = parseRoute(`/threads/${threadId}`, `?changeSet=${setId}`);
  assert.deepEqual(route, { page: "thread", id: threadId, changeSet: setId });
  assert.equal(routeUrl(route), `/threads/${threadId}?changeSet=${setId}`);
  assert.equal(
    routeUrl({ ...route, item: "jira:OA-1" }),
    `/threads/${threadId}?changeSet=${setId}&item=jira%3AOA-1`,
  );
  assert.deepEqual(parseRoute(`/threads/${threadId}`, "?changeSet=nope"), {
    page: "thread",
    id: threadId,
  });
});

test("a reply links to a thread or a change set in Oriel, and never elsewhere that way", () => {
  assert.deepEqual(inAppRoute(`/threads/${threadId}?changeSet=${setId}`), {
    page: "thread",
    id: threadId,
    changeSet: setId,
  });
  for (const target of [
    "/threads/new",
    `//example.com/threads/${threadId}`,
    `/threads/${threadId}/../../done`,
    `https://example.com/threads/${threadId}`,
    "/review/abc",
  ])
    assert.equal(inAppRoute(target), null, target);
  const [paragraph] = parse(`It was [this change set](/threads/${threadId}?changeSet=${setId}).`);
  assert.deepEqual(paragraph, {
    kind: "paragraph",
    children: [
      { kind: "text", text: "It was " },
      {
        kind: "route",
        route: { page: "thread", id: threadId, changeSet: setId },
        children: [{ kind: "text", text: "this change set" }],
      },
      { kind: "text", text: "." },
    ],
  });
});

const set = (id: string): ChangeSetView => ({
  id,
  status: "applied",
  nextSteps: [],
  applying: false,
  sentUnapplied: false,
  decision: null,
  errors: [],
  revertOf: null,
  reverts: [],
  createdAt: at,
});

const view: ThreadView = {
  id: threadId,
  title: "Try a Slack post",
  workstream: { id: "01JBZ0000000000000000000G1", name: "SMS updates", version: 1 },
  state: "done",
  doneBy: "applied",
  regionVersion: 1,
  members: [],
  entries: [
    { seq: 1, at, kind: "user", text: "Post a test" },
    { seq: 2, at, kind: "change-set", changeSetId: setId },
    { seq: 3, at, kind: "text", text: "Posted." },
  ],
  lastSeq: 3,
  running: false,
  changeSets: [set(setId)],
  writable: true,
};
const loaded: Msg = {
  type: "replied",
  tag: { kind: "thread", id: threadId },
  ok: true,
  body: view,
};
const rendered: Msg = { type: "thread", msg: { type: "rendered" } };

test("a thread opens at the change set its address names, once it has rendered, and only once", () => {
  const [start] = init({ page: "done" });
  const [opening] = update(start, {
    type: "routed",
    route: { page: "thread", id: threadId, changeSet: setId },
  });
  assert.equal(opening.thread?.atLatest, false);
  const [shown, effects] = update(opening, loaded);
  assert.ok(effects.some((e) => e.type === "rendered"));
  const [there, scrolled] = update(shown, rendered);
  assert.deepEqual(scrolled, [{ type: "showChangeSet", changeSetId: setId }]);
  assert.deepEqual(there.thread?.at, { changeSet: setId, shown: true });
  // Later renders leave the page where the user is.
  assert.deepEqual(update(there, rendered)[1], []);
  assert.deepEqual(
    update(there, loaded)[1].filter((e) => e.type === "rendered"),
    [],
  );
});

test("a change set the thread doesn't have opens it at its latest entry", () => {
  const [start] = init({ page: "thread", id: threadId, changeSet: other });
  const [stale, scrolled] = run(start, loaded, rendered);
  assert.deepEqual(scrolled, [{ type: "showLatest" }]);
  assert.equal(stale.thread?.atLatest, true);
});
