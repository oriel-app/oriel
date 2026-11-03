// The overview through the server (decision 0027): computed from the index,
// the change log, workstreams, threads and review links when it is asked
// for, never by a model; and leaving it marks what it showed as seen.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import type { IndexRecord, Instant } from "@oriel/core";
import type {
  OverviewView,
  ThreadView,
  Undoable,
  WindowView,
  WorkstreamSummary,
} from "@oriel/web/view";
import { buildFolder, loadFolderFixture } from "../../../scripts/fixtures/folder.ts";
import type { Agent } from "./agent.ts";
import { overviewView } from "./overview.ts";
import { json, testApp } from "./testing.ts";

const overview = async (app: { get(url: string): Promise<{ body: unknown }> }) =>
  json<OverviewView>((await app.get("/api/overview")) as never);

// SYN-3's epic, weather disruptions and rebooking, keyed by its stable ID.
const weather = { kind: "cluster", grouping: "epic", cluster: "10003" };

// A model that must never be asked: the overview calls none.
const throwing: Agent = {
  turn() {
    throw new Error("the overview called a model");
  },
};

async function fixtureWindow(t: TestContext) {
  const app = await testApp(t, {
    slack: { kind: "fixture" },
    agent: () => throwing,
    titler: () => {
      throw new Error("the overview called a model");
    },
  });
  const dir = mkdtempSync(join(tmpdir(), "oriel-server-overview-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const folder = buildFolder(loadFolderFixture(), dir);
  assert.equal((await app.post("/api/folder", { path: folder.root })).status, 200);
  return app;
}

test("the fixture window's overview ranks every source's candidates, computed with no model", async (t) => {
  const app = await fixtureWindow(t);
  const view = await overview(app);
  assert.equal(view.asOf, "2026-10-02T11:00:00.000Z");
  assert.equal(view.lastSeen, null);
  assert.equal(view.counts.notInWorkstream, view.candidates.total);
  assert.ok(view.candidates.rows.length <= 8);
  for (const row of view.candidates.rows) assert.ok(row.rule.length > 0 && row.source.length > 0);
  // Ranked by weight, heaviest first.
  const weights = view.candidates.rows.map((row) => row.weight);
  assert.deepEqual(
    weights,
    weights.toSorted((a, b) => b - a),
  );
  // Mixing sources, each row's own, and a Linked cluster's every one it spans.
  const named = view.candidates.rows.map((row) => row.source);
  assert.ok(named.includes("Jira") && named.includes("Slack"));
  assert.deepEqual(
    new Set(named.flatMap((source) => source.split(" · "))),
    new Set(["Jira", "Slack"]),
  );
  // An epic's row counts what Make a workstream would hold, the epic too, as
  // its Browse row does.
  const epic = view.candidates.rows.find(
    (row) => row.subject.kind === "cluster" && row.subject.grouping === "epic",
  );
  assert.ok(epic?.subject.kind === "cluster" && epic.subject.lead !== null);
  const { key, size } = epic.subject;
  const browsed = json<WindowView>(await app.get("/api/browse?grouping=epic")).clusters.find(
    (cluster) => cluster.row.key === key,
  );
  assert.equal(size, browsed?.row.size);
  assert.equal(
    view.headlines.find((line) => line.id === "top")?.rule,
    view.candidates.rows[0]?.rule,
  );
  // In progress by person, most first: everyone, as the fixture has fewer
  // than the 10 it shows.
  assert.equal(view.people.rows.length, view.people.total);
  const counts = view.people.rows.map((person) => person.inProgress);
  assert.deepEqual(
    counts,
    counts.toSorted((a, b) => b - a),
  );
  assert.deepEqual(view.workstreams, []);
  assert.deepEqual(view.needsYou, { threads: [], unopened: [] });
});

test("a workstream's row, and its epic no longer a candidate", async (t) => {
  const app = await fixtureWindow(t);
  const made = json<WorkstreamSummary>(await app.post("/api/workstreams", weather));
  const view = await overview(app);
  const [row] = view.workstreams;
  assert.equal(row?.id, made.id);
  assert.equal(row.size, made.size);
  assert.deepEqual(row.bySource, [{ source: "Jira", count: made.size }]);
  assert.equal(row.status.todo + row.status["in-progress"] + row.status.done, made.size);
  assert.equal(row.activity.length, 14);
  assert.ok(
    !view.candidates.rows.some(
      (c) => c.subject.kind === "cluster" && c.subject.key === weather.cluster,
    ),
  );
  for (const signal of row.signals) assert.ok(signal.rule.length > 0);
  // Its people's top workstream is it, where it holds most of their work.
  assert.ok(view.people.rows.some((person) => person.top?.id === made.id));
});

test("a thread waiting on the user, and a review link nobody opened, need them", async (t) => {
  const app = await testApp(t, {
    plan: () => [{ run: "estimate" }],
    scripts: {
      estimate: async () => ({ writes: [["jira.setEstimate", ["jira:SYN-45", 3]]] }),
    },
  });
  const made = json<WorkstreamSummary>(await app.post("/api/workstreams", weather));
  const opened = json<{ id: string }>(
    await app.post(`/api/workstreams/${made.id}/threads`, { text: "Estimate SYN-45" }),
  );
  await app.app.settled();
  const thread = json<ThreadView>(await app.get(`/api/threads/${opened.id}`));
  const entry = thread.entries.find((each) => each.kind === "change-set");
  assert.ok(entry?.kind === "change-set");
  const minted = json<{ url: string }>(
    await app.post(`/api/change-sets/${entry.changeSetId}/review-link`),
  );
  const before = await overview(app);
  assert.deepEqual(
    before.needsYou.threads.map((each) => [each.id, each.waitingOn]),
    [[opened.id, "review"]],
  );
  assert.equal(before.counts.needsYou, 1);
  assert.deepEqual(before.needsYou.unopened, [
    {
      changeSetId: entry.changeSetId,
      thread: { id: opened.id, title: thread.title },
      workstream: { id: made.id, name: made.name },
      sentAt: "2026-10-29T09:00:00.000Z",
    },
  ]);
  assert.equal(before.workstreams[0]?.threads.waiting, 1);
  const token = new URL(minted.url).pathname.split("/").at(-1);
  assert.equal((await app.post("/api/review/open", { token })).status, 200);
  assert.deepEqual((await overview(app)).needsYou.unopened, []);
});

test("what changed since the user left the overview, up to what it showed", async (t) => {
  const app = await testApp(t, { live: true });
  assert.ok(app.site);
  const made = json<WorkstreamSummary>(await app.post("/api/workstreams", weather));
  app.site.edit("SYN-45", { status: "Done" });
  app.advance(60_000);
  assert.equal((await app.post("/api/jira/sync")).status, 200);
  const shown = await overview(app);
  assert.deepEqual(shown.counts, {
    changed: 1,
    workstreamsMoved: 1,
    needsYou: 0,
    notInWorkstream: shown.candidates.total,
  });
  assert.deepEqual(shown.changed, {
    workstreams: [{ id: made.id, name: made.name, moved: 1 }],
    elsewhere: 0,
  });
  const [row] = shown.workstreams;
  assert.deepEqual(
    [row?.moved, row?.movedDone, row?.movedItems.map((item) => item.key)],
    [1, 1, ["SYN-45"]],
  );
  assert.equal(shown.headlines[0]?.id, "moved");
  // A change that commits after the page rendered stays unseen once it's left.
  app.site.edit("SYN-61", { status: "Done" });
  app.advance(60_000);
  assert.equal((await app.post("/api/jira/sync")).status, 200);
  const left = await app.post("/api/overview/leave", { seq: shown.seq });
  assert.equal(left.status, 200);
  const after = await overview(app);
  assert.equal(after.lastSeen, "2026-10-29T09:02:00.000Z");
  assert.equal(after.counts.changed, 1);
  assert.equal(after.changed.elsewhere + (after.changed.workstreams[0]?.moved ?? 0), 1);
  assert.equal((await app.post("/api/overview/leave", { seq: -1 })).status, 400);
});

test("in progress by person shows the top 10 of everyone, an epic not counting as work", () => {
  const record = (n: number, person: number, kind = "story"): IndexRecord => ({
    id: `jira:SYN-${n}`,
    stableId: `${n}`,
    title: `Story ${n}`,
    location: `https://example.invalid/browse/SYN-${n}`,
    updatedAt: "2026-10-01T00:00:00.000Z" as Instant,
    facets: {
      kind,
      state: "in-progress",
      people: [{ role: "assignee", id: `p${person}`, name: `Person ${person}` }],
    },
    attrs: {},
  });
  // Person 0 has two stories and an epic; everyone else one story.
  const records = [
    record(100, 0),
    record(101, 0),
    record(102, 0, "epic"),
    ...Array.from({ length: 11 }, (_, n) => record(n + 1, n + 1)),
  ];
  const view = overviewView({
    records,
    changes: [],
    seen: null,
    workstreams: [],
    threads: [],
    unopened: [],
    clusters: () => [],
    now: "2026-10-30T00:00:00.000Z" as Instant,
  });
  assert.equal(view.people.total, 12);
  assert.equal(view.people.rows.length, 10);
  assert.deepEqual(view.people.rows[0], { id: "p0", name: "Person 0", inProgress: 2, top: null });
});

test("Make a workstream on the SYN-54 Linked cluster, then its Undo: the section follows", async (t) => {
  const app = await testApp(t, { slack: { kind: "fixture" } });
  const before = await overview(app);
  assert.ok(before.candidates.rows.length <= 8);
  for (const row of before.candidates.rows) assert.ok(row.rule.length > 0);
  const linked = before.candidates.rows.find(
    (row) => row.subject.kind === "cluster" && row.subject.grouping === "linked",
  );
  assert.ok(linked?.subject.kind === "cluster");
  assert.equal(linked.subject.lead?.key, "SYN-54");
  assert.equal(linked.source, "Jira · Slack");
  const made = json<Undoable<WorkstreamSummary>>(
    await app.post("/api/workstreams", {
      kind: "cluster",
      grouping: linked.subject.grouping,
      cluster: linked.subject.key,
    }),
  );
  // The row's count is what Make a workstream holds.
  assert.equal(made.size, linked.subject.size);
  assert.deepEqual(made.undo, { action: "workstream.delete", input: { workstream: made.id } });
  assert.equal(
    (
      await app.post("/api/telemetry", {
        name: "overview.suggestion-made",
        workstreamId: made.id,
        grouping: "linked",
      })
    ).status,
    202,
  );
  assert.deepEqual(app.app.telemetry().at(-1)?.data, { workstreamId: made.id, grouping: "linked" });
  const after = await overview(app);
  const keys = (view: OverviewView) =>
    view.candidates.rows.flatMap((row) =>
      row.subject.kind === "cluster" ? [row.subject.key] : [],
    );
  assert.ok(!keys(after).includes(linked.subject.key));
  assert.equal(after.counts.notInWorkstream, before.counts.notInWorkstream - 1);
  assert.equal(after.workstreams[0]?.id, made.id);
  // Its Undo deletes it, and the cluster is a candidate again.
  assert.equal((await app.post(`/api/actions/${made.undo.action}`, made.undo.input)).status, 200);
  const undone = await overview(app);
  assert.deepEqual(undone.workstreams, []);
  assert.ok(keys(undone).includes(linked.subject.key));
});

test("Browse's not-in-a-workstream filter keeps only what no open workstream holds", async (t) => {
  const app = await testApp(t);
  await app.post("/api/workstreams", weather);
  const ids = async (query: string) =>
    json<WindowView>(await app.get(`/api/browse?grouping=epic${query}`)).clusters.map(
      (cluster) => cluster.row.key,
    );
  assert.ok((await ids("")).includes(weather.cluster));
  assert.ok(!(await ids("&workstream=none")).includes(weather.cluster));
});
