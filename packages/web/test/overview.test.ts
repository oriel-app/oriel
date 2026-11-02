// The overview at `/` (decision 0027): entering it loads it and counts as
// opening it; leaving it marks seen up to the change log entry it showed;
// a section's "more" opens in place or in Browse, and is counted either way;
// and it loads again when the workspace changes.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Effect } from "../src/http.ts";
import { init, type Model, type Msg, update } from "../src/root.ts";
import type { Route } from "../src/route.ts";
import { overviewView, workstreamSummary } from "../testing.ts";

function run(model: Model, ...msgs: Msg[]): [Model, Effect[]] {
  let effects: Effect[] = [];
  for (const msg of msgs) [model, effects] = update(model, msg);
  return [model, effects];
}

const loaded = (seq: number): Msg => ({
  type: "replied",
  tag: { kind: "overview" },
  ok: true,
  body: overviewView({ seq }),
});

const posts = (effects: Effect[]) =>
  effects.flatMap((effect) =>
    effect.type === "http" && effect.method === "POST" ? [[effect.url, effect.body]] : [],
  );
const gets = (effects: Effect[]) =>
  effects.flatMap((effect) =>
    effect.type === "http" && effect.method === "GET" ? [effect.url] : [],
  );

test("entering the overview loads it and counts as opening it", () => {
  const [model, effects] = init({ page: "overview" });
  assert.ok(gets(effects).includes("/api/overview"));
  assert.deepEqual(posts(effects), [["/api/telemetry", { name: "overview.opened" }]]);
  assert.equal(model.overview?.view, null);
});

test("leaving marks seen up to the entry the overview showed, not one loaded since", () => {
  const [shown] = run(init({ page: "overview" })[0], loaded(7));
  const browse: Route = { page: "window", grouping: "epic", addTo: null };
  const [, effects] = run(shown, { type: "routed", route: browse });
  assert.deepEqual(posts(effects), [["/api/overview/leave", { seq: 7 }]]);
  // Opening an item in the panel isn't leaving.
  const [, panel] = run(shown, { type: "routed", route: { page: "overview", item: "jira:SYN-1" } });
  assert.ok(!posts(panel).some(([url]) => url === "/api/overview/leave"));
  // An overview that never loaded showed nothing to mark seen.
  const [, unseen] = run(init({ page: "overview" })[0], { type: "routed", route: browse });
  assert.deepEqual(posts(unseen), []);
});

test("a section's more opens in place, or goes to Browse, and is counted either way", () => {
  const [shown] = run(init({ page: "overview" })[0], loaded(1));
  const [opened, effects] = run(shown, {
    type: "overview",
    msg: { type: "moreOpened", section: "needs-you", to: null },
  });
  assert.deepEqual(opened.overview?.opened, ["needs-you"]);
  assert.deepEqual(posts(effects), [
    ["/api/telemetry", { name: "overview.more-opened", section: "needs-you" }],
  ]);
  const to: Route = { page: "window", grouping: "assignee", addTo: null, status: "in-progress" };
  const [, going] = run(shown, {
    type: "overview",
    msg: { type: "moreOpened", section: "people", to },
  });
  assert.deepEqual(going.at(-1), { type: "navigate", route: to });
});

test("the overview loads again when the workspace changes, keeping what it shows meanwhile", () => {
  const [shown] = run(init({ page: "overview" })[0], loaded(3));
  const [model, effects] = run(shown, { type: "threadsMoved" });
  assert.ok(gets(effects).includes("/api/overview"));
  assert.equal(model.overview?.view?.seq, 3);
});

test("Make a workstream on a suggested cluster: the overview and the sidebar load again, with its Undo", () => {
  const [shown] = run(init({ page: "overview" })[0], loaded(1));
  const [making, asked] = run(shown, {
    type: "overview",
    msg: { type: "makeClicked", grouping: "linked", key: "jira:10054" },
  });
  assert.equal(making.overview?.making, "jira:10054");
  assert.deepEqual(posts(asked), [
    ["/api/workstreams", { kind: "cluster", grouping: "linked", cluster: "jira:10054" }],
  ]);
  const undo = { action: "workstream.delete", input: { workstream: "01JBZ0000000000000000000G9" } };
  const [made, effects] = run(making, {
    type: "replied",
    tag: { kind: "overviewMade", key: "jira:10054", grouping: "linked" },
    ok: true,
    body: { ...workstreamSummary({ id: "01JBZ0000000000000000000G9" }), undo },
  });
  assert.equal(made.overview?.making, null);
  assert.deepEqual(
    made.overview?.made.map((each) => each.key),
    ["jira:10054"],
  );
  assert.ok(gets(effects).includes("/api/overview"));
  assert.ok(gets(effects).includes("/api/workstreams"));
  assert.deepEqual(posts(effects), [
    [
      "/api/telemetry",
      {
        name: "overview.suggestion-made",
        workstreamId: "01JBZ0000000000000000000G9",
        grouping: "linked",
      },
    ],
  ]);
  const [, undoing] = run(made, {
    type: "overview",
    msg: { type: "undoClicked", key: "jira:10054" },
  });
  assert.deepEqual(posts(undoing), [["/api/actions/workstream.delete", undo.input]]);
  const [gone, reloads] = run(made, {
    type: "replied",
    tag: { kind: "overviewUnmade", key: "jira:10054" },
    ok: true,
    body: { undo: null },
  });
  assert.deepEqual(gone.overview?.made, []);
  assert.ok(gets(reloads).includes("/api/overview"));
});
