// The stand-in tracker (decision 0059, OA-274): on while no tracker is
// connected, its issues in Oriel's own database. The window chat drafts a
// plan into it as a change set, which lands in the index at once when
// approved; a person edits its issues in their panel, at once, with Undo;
// with Jira connected, nothing of it shows, and its issues stay for when
// it's on again.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import type {
  ConnectorView,
  DiffView,
  OverviewView,
  ThreadView,
  WindowView,
} from "@oriel/web/view";
import { account, json, type Script, testApp } from "./testing.ts";

const details = {
  site: "oriel.atlassian.net",
  email: account.email,
  token: account.token,
  project: "syn",
};

// What the window chat's agent drafts for "plan a small launch".
const plan: Script = async () => ({
  value: null,
  writes: [
    ["tracker.createEpic", [{ summary: "Spring launch" }], "new:1"],
    ["tracker.createStory", [{ summary: "Pricing page", points: 3, epic: "new:1" }], "new:2"],
    ["tracker.createStory", [{ summary: "Launch email", epic: "new:1" }], "new:3"],
  ],
});

// The thread in which Oriel offers to move the stand-in's issues, its note
// and its change set.
async function moving(it: Awaited<ReturnType<typeof testApp>>) {
  const threads = json<{ threads: { id: string; title: string }[] }>(await it.get("/api/threads"));
  const thread = threads.threads.find((each) => each.title === "Into Jira");
  assert.ok(thread, "Oriel offered the move in a thread of its own");
  const view = json<ThreadView>(await it.get(`/api/threads/${thread.id}`));
  const note = view.entries.find((each) => each.kind === "note");
  const set = view.entries.find((each) => each.kind === "change-set");
  assert.ok(note?.kind === "note" && set?.kind === "change-set");
  return { note: note.note, changeSetId: set.changeSetId };
}

// A window with Jira not connected yet, as the desktop app's first run is.
async function fresh(t: TestContext, db?: string) {
  const it = await testApp(t, {
    ...(db ? { db } : {}),
    connect: {},
    plan: (input) => (input.text.startsWith("Draft") ? [{ run: "plan" }] : [{ text: "Hello." }]),
    scripts: { plan },
  });
  const browse = async () =>
    json<WindowView>(await it.get("/api/browse?grouping=epic")).clusters.map((c) => [
      c.row.label,
      c.row.size,
    ]);
  const ask = async (text: string) => {
    await it.post("/api/window-chat/messages", { text });
    await it.app.settled();
    const thread = json<{ thread: string }>(await it.get("/api/window-chat")).thread;
    return json<ThreadView>(await it.get(`/api/threads/${thread}`));
  };
  const approve = async (changeSetId: string) => {
    const diff = json<DiffView>(await it.post(`/api/change-sets/${changeSetId}/diff`));
    it.advance(1000);
    const reply = await it.post(`/api/change-sets/${changeSetId}/approve`, { hash: diff.hash });
    await it.app.settled();
    return { status: reply.status, diff };
  };
  const events = (name: string) =>
    it.app
      .telemetry()
      .filter((event) => event.name === name)
      .map((event) => event.data);
  return { ...it, browse, ask, approve, events };
}

test("with no tracker connected, the window chat's plan lands in the stand-in once approved, and every view sees it at once", async (t) => {
  const it = await fresh(t);
  const view = await it.ask("Draft a small launch plan: one epic and a few stories I can edit");
  const entry = view.entries.find((each) => each.kind === "change-set");
  assert.ok(entry?.kind === "change-set", "one change set");
  const { status, diff } = await it.approve(entry.changeSetId);
  assert.equal(status, 200);
  assert.deepEqual(
    diff.lines.map((line) => line.sentence),
    [
      "Create an epic “Spring launch”.",
      "Create a story “Pricing page” in the new epic “Spring launch”, estimated at 3 points.",
      "Create a story “Launch email” in the new epic “Spring launch”.",
    ],
  );
  // Browse, by epic, has the epic and its stories.
  assert.deepEqual(await it.browse(), [["Spring launch", 3]]);
  // Browse's item search finds one by its title, as search() does.
  const searched = json<WindowView>(await it.get("/api/browse?grouping=epic&q=pricing")).clusters;
  assert.deepEqual(
    searched.map((cluster) => [cluster.row.label, cluster.matched]),
    [["Spring launch", 1]],
  );
  // The panel reads one, with its form.
  const panel = json<{ read: { status: string; edit?: { fields: { name: string }[] } } }>(
    await it.get("/api/items/tracker%3AT-2"),
  );
  assert.equal(panel.read.status, "ok");
  assert.ok(panel.read.edit?.fields.some((field) => field.name === "summary"));
  assert.deepEqual(it.events("standin.written"), [
    { source: "tracker", by: "change-set", change: "created", fields: [] },
    { source: "tracker", by: "change-set", change: "created", fields: [] },
    { source: "tracker", by: "change-set", change: "created", fields: [] },
  ]);
  // Nothing synced it: the sync worker never ran on the tracker.
  assert.ok(
    !it.logged.some(
      (line) => line.message === "sync: finished" && line.fields.source === "tracker",
    ),
  );
});

test("a person's edit of a stand-in issue applies at once, and its Undo puts back what it replaced", async (t) => {
  const it = await fresh(t);
  const view = await it.ask("Draft a small launch plan: one epic and a few stories I can edit");
  const entry = view.entries.find((each) => each.kind === "change-set");
  assert.ok(entry?.kind === "change-set");
  await it.approve(entry.changeSetId);
  const edit = (values: Record<string, unknown>) =>
    it.post("/api/actions/item.edit", { item: "tracker:T-3", values });
  const reply = await edit({ status: "In progress", assignee: "Ada Quill", points: 2 });
  assert.equal(reply.status, 200);
  const { undo } = json<{ undo: { action: string; input: unknown } | null }>(reply);
  assert.deepEqual(undo, {
    action: "item.edit",
    input: { item: "tracker:T-3", values: { status: "To do", points: null, assignee: null } },
  });
  const people = json<WindowView>(await it.get("/api/browse?grouping=assignee")).clusters;
  assert.ok(people.some((cluster) => cluster.row.label === "Ada Quill" && cluster.row.size === 1));
  // Undone through the one door every Undo takes.
  assert.ok(undo);
  const undone = await it.post(`/api/actions/${undo.action}`, undo.input);
  assert.equal(undone.status, 200);
  const again = json<WindowView>(await it.get("/api/browse?grouping=assignee")).clusters;
  assert.ok(!again.some((cluster) => cluster.row.label === "Ada Quill"));
  assert.deepEqual(it.events("standin.written").slice(-2), [
    { source: "tracker", by: "person", change: "edited", fields: ["status", "points", "assignee"] },
    { source: "tracker", by: "person", change: "edited", fields: ["status", "points", "assignee"] },
  ]);
  // What it can't take, it refuses; and Jira's items are never edited so.
  assert.equal((await edit({ status: "Shipped" })).status, 400);
  const jira = await it.post("/api/actions/item.edit", {
    item: "jira:SYN-1",
    values: { summary: "x" },
  });
  assert.equal(jira.status, 403);
});

test("a tracker turning on is offered the stand-in's issues; approved, the stand-in steps aside and keeps them while it's off", async (t) => {
  const top = mkdtempSync(join(tmpdir(), "oriel-standin-"));
  t.after(() => rmSync(top, { recursive: true, force: true }));
  const path = join(top, "window.db");
  const it = await fresh(t, path);
  const view = await it.ask("Draft a small launch plan: one epic and a few stories I can edit");
  const entry = view.entries.find((each) => each.kind === "change-set");
  assert.ok(entry?.kind === "change-set");
  await it.approve(entry.changeSetId);
  // The window chat's workstream holds what its change set created, as
  // the overview's card for it says.
  const overview = async () => json<OverviewView>(await it.get("/api/overview"));
  const held = (view: OverviewView) =>
    view.workstreams.some((row) => row.size === 3 && row.bySource[0]?.source === "Tracker");
  assert.ok(held(await overview()));
  // It's among the connections, as the tracker that's on, which Oriel
  // keeps itself, so the sidebar's Sources and Settings show it.
  const listed = json<{ connections: { kind: string; own: boolean; items: number }[] }>(
    await it.get("/api/connections"),
  );
  assert.deepEqual(
    listed.connections.map((each) => [each.kind, each.own, each.items]),
    [["tracker", true, 3]],
  );

  // Jira connected: Oriel offers one change set that makes the stand-in's
  // issues again in Jira (decision 0059), and both stay until it applies.
  assert.equal((await it.connect("jira", details)).status, 200);
  assert.deepEqual(
    json<{ connections: { kind: string }[] }>(await it.get("/api/connections")).connections.map(
      (each) => each.kind,
    ),
    ["jira", "tracker"],
  );
  const offer = await moving(it);
  assert.deepEqual(offer.note, {
    kind: "moving",
    changeSetId: offer.changeSetId,
    from: "Oriel's tracker",
    into: "Jira",
    items: 3,
  });
  const moved = await it.approve(offer.changeSetId);
  assert.equal(moved.status, 200);
  assert.deepEqual(
    moved.diff.lines.map((line) => [line.source, line.sentence]),
    [
      ["Jira", "Create an epic “Spring launch”."],
      [
        "Jira",
        "Create a story “Pricing page” in the new epic “Spring launch”, estimated at 3 points.",
      ],
      ["Jira", "Create a story “Launch email” in the new epic “Spring launch”."],
    ],
  );
  const made = it.site?.issue("SYN-900") ? ["SYN-900", "SYN-901", "SYN-902"] : [];
  assert.deepEqual(
    made.map((key) => [it.site?.issue(key)?.summary, it.site?.issue(key)?.epic]),
    [
      ["Spring launch", null],
      ["Pricing page", "SYN-900"],
      ["Launch email", "SYN-900"],
    ],
  );
  assert.equal(it.site?.issue("SYN-901")?.points, 3);
  // Its workstream holds the new items in place of the stand-in's.
  const after = await overview();
  assert.ok(after.workstreams.some((row) => row.size === 3 && row.bySource[0]?.source === "Jira"));
  assert.ok(!after.workstreams.some((row) => row.bySource.some((by) => by.source === "Tracker")));
  assert.deepEqual(it.events("standin.moving"), [
    { source: "jira", step: "offered", items: 3 },
    { source: "jira", step: "moved", items: 3 },
  ]);
  // Moved: nothing of the stand-in shows.
  assert.deepEqual(
    json<{ connections: { kind: string }[] }>(await it.get("/api/connections")).connections.map(
      (each) => each.kind,
    ),
    ["jira"],
  );
  // "Spring launch" is Jira's now; none of the stand-in's rows shows.
  const rows = it.app.window("epic").clusters.flatMap((cluster) => cluster.list);
  assert.ok(rows.some((row) => row.id.startsWith("jira:") && row.title === "Pricing page"));
  assert.ok(!rows.some((row) => row.id.startsWith("tracker:")));
  const read = json<{ read: { status: string } }>(await it.get("/api/items/tracker%3AT-2"));
  assert.notEqual(read.read.status, "ok");
  // A blank region's module offers no tracker creates: what's off, the agent can't propose.
  const blank = await it.ask("Draft a small launch plan: one epic and a few stories I can edit");
  assert.ok(
    !blank.entries.some((each) => each.kind === "change-set"),
    "a fresh window chat's creates have nowhere to go",
  );

  // Jira disconnected: it's on again, with its issues as they were.
  const jira = json<{ connections: { id: string; kind: string }[] }>(
    await it.get("/api/connections"),
  ).connections.find((each) => each.kind === "jira");
  assert.ok(jira);
  assert.equal((await it.post(`/api/connections/${jira.id}/disconnect`)).status, 200);
  assert.deepEqual(await it.browse(), [["Spring launch", 3]]);
});

test("rejected, Oriel's offer to move the stand-in's issues leaves both trackers on", async (t) => {
  const it = await fresh(t);
  const view = await it.ask("Draft a small launch plan: one epic and a few stories I can edit");
  const entry = view.entries.find((each) => each.kind === "change-set");
  assert.ok(entry?.kind === "change-set");
  await it.approve(entry.changeSetId);
  assert.equal((await it.connect("jira", details)).status, 200);
  const offer = await moving(it);
  const diff = json<DiffView>(await it.post(`/api/change-sets/${offer.changeSetId}/diff`));
  const rejected = await it.post(`/api/change-sets/${offer.changeSetId}/reject`, {
    hash: diff.hash,
  });
  assert.equal(rejected.status, 200);
  await it.app.settled();
  assert.deepEqual(
    json<{ connections: { kind: string }[] }>(await it.get("/api/connections")).connections.map(
      (each) => each.kind,
    ),
    ["jira", "tracker"],
  );
  assert.ok((await it.browse()).some(([label, size]) => label === "Spring launch" && size === 3));
  assert.equal(it.site?.issue("SYN-900"), null, "nothing was made in Jira");
});

test("a move with an issue left out keeps the stand-in on, for the issue still only there", async (t) => {
  const it = await fresh(t);
  const view = await it.ask("Draft a small launch plan: one epic and a few stories I can edit");
  const entry = view.entries.find((each) => each.kind === "change-set");
  assert.ok(entry?.kind === "change-set");
  await it.approve(entry.changeSetId);
  assert.equal((await it.connect("jira", details)).status, 200);
  const offer = await moving(it);
  const diff = json<DiffView>(await it.post(`/api/change-sets/${offer.changeSetId}/diff`));
  const last = diff.lines.at(-1)?.mutationId;
  assert.ok(last);
  assert.equal(
    (await it.post(`/api/change-sets/${offer.changeSetId}/edit`, { remove: [last] })).status,
    200,
  );
  assert.equal((await it.approve(offer.changeSetId)).status, 200);
  assert.deepEqual(
    json<{ connections: { kind: string }[] }>(await it.get("/api/connections")).connections.map(
      (each) => each.kind,
    ),
    ["jira", "tracker"],
    "the left-out story stays reachable, in the stand-in",
  );
});

test("a move reverted puts the stand-in back on, with its workstream holding its issues again", async (t) => {
  const it = await fresh(t);
  const view = await it.ask("Draft a small launch plan: one epic and a few stories I can edit");
  const entry = view.entries.find((each) => each.kind === "change-set");
  assert.ok(entry?.kind === "change-set");
  await it.approve(entry.changeSetId);
  assert.equal((await it.connect("jira", details)).status, 200);
  const offer = await moving(it);
  assert.equal((await it.approve(offer.changeSetId)).status, 200);
  const kinds = async () =>
    json<{ connections: { kind: string }[] }>(await it.get("/api/connections")).connections.map(
      (each) => each.kind,
    );
  assert.deepEqual(await kinds(), ["jira"]);
  it.advance(1000);
  const reverted = await it.post(`/api/change-sets/${offer.changeSetId}/revert`);
  assert.equal(reverted.status, 200);
  // Made, the revert is a change set of its own: until it applies, the move
  // stands.
  assert.deepEqual(await kinds(), ["jira"]);
  const { revert } = json<{ revert: string }>(reverted);
  assert.equal((await it.approve(revert)).status, 200);
  assert.deepEqual(await kinds(), ["jira", "tracker"]);
  const overview = json<OverviewView>(await it.get("/api/overview"));
  assert.ok(
    overview.workstreams.some((row) => row.size === 3 && row.bySource[0]?.source === "Tracker"),
  );
});

test("a move's revert that deleted nothing in Jira leaves the move as it was", async (t) => {
  const it = await fresh(t);
  const view = await it.ask("Draft a small launch plan: one epic and a few stories I can edit");
  const entry = view.entries.find((each) => each.kind === "change-set");
  assert.ok(entry?.kind === "change-set");
  await it.approve(entry.changeSetId);
  assert.equal((await it.connect("jira", details)).status, 200);
  const offer = await moving(it);
  assert.equal((await it.approve(offer.changeSetId)).status, 200);
  it.advance(1000);
  const { revert } = json<{ revert: string }>(
    await it.post(`/api/change-sets/${offer.changeSetId}/revert`),
  );
  // Jira refuses every delete: nothing of the move is undone.
  for (const key of ["SYN-900", "SYN-901", "SYN-902"]) it.site?.refuse(key);
  await it.approve(revert);
  assert.deepEqual(
    json<{ connections: { kind: string }[] }>(await it.get("/api/connections")).connections.map(
      (each) => each.kind,
    ),
    ["jira"],
  );
  const overview = json<OverviewView>(await it.get("/api/overview"));
  assert.ok(
    !overview.workstreams.some((row) => row.bySource.some((by) => by.source === "Tracker")),
  );
});

test("a move's revert stopped partway, then retried, gives every workstream back all the stand-in's issues", async (t) => {
  const it = await fresh(t);
  const view = await it.ask("Draft a small launch plan: one epic and a few stories I can edit");
  const entry = view.entries.find((each) => each.kind === "change-set");
  assert.ok(entry?.kind === "change-set");
  await it.approve(entry.changeSetId);
  assert.equal((await it.connect("jira", details)).status, 200);
  const offer = await moving(it);
  assert.equal((await it.approve(offer.changeSetId)).status, 200);
  it.advance(1000);
  const { revert } = json<{ revert: string }>(
    await it.post(`/api/change-sets/${offer.changeSetId}/revert`),
  );
  // Jira refuses one delete: the revert stops there.
  it.site?.refuse("SYN-901");
  await it.approve(revert);
  it.site?.allow("SYN-901");
  it.advance(1000);
  assert.equal((await it.post(`/api/change-sets/${revert}/apply`)).status, 200);
  await it.app.settled();
  const overview = json<OverviewView>(await it.get("/api/overview"));
  assert.ok(
    overview.workstreams.some((row) => row.size === 3 && row.bySource[0]?.source === "Tracker"),
  );
  assert.ok(!overview.workstreams.some((row) => row.bySource.some((by) => by.source === "Jira")));
});

test("the stand-in shows as a writable connector with no connect steps", async (t) => {
  const it = await fresh(t);
  const { connectors } = json<{ connectors: ConnectorView[] }>(await it.get("/api/connectors"));
  const tracker = connectors.find((each) => each.kind === "tracker");
  assert.deepEqual([tracker?.name, tracker?.writable, tracker?.connect], ["Tracker", true, null]);
});
