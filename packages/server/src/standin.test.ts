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
import type { DiffView, OverviewView, ThreadView, WindowView } from "@oriel/web/view";
import { json, type Script, testApp } from "./testing.ts";

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
  assert.deepEqual(view.move, { went: null }, "its rail says where what it creates goes");
  return { note: note.note, changeSetId: set.changeSetId, threadId: thread.id };
}

// A window with Jira not on yet, as the desktop app's first run is, and
// Atlassian's server in the person's agent to turn it on through.
async function fresh(t: TestContext, db?: string) {
  const it = await testApp(t, {
    ...(db ? { db } : {}),
    atlassian: true,
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
  return { ...it, browse, ask, approve };
}

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
  const it = await fresh(t, join(top, "window.db"));
  const view = await it.ask("Draft a small launch plan: one epic and a few stories I can edit");
  const entry = view.entries.find((each) => each.kind === "change-set");
  assert.ok(entry?.kind === "change-set");
  await it.approve(entry.changeSetId);
  const kinds = async () =>
    json<{ connections: { kind: string }[] }>(await it.get("/api/connections")).connections.map(
      (each) => each.kind,
    );

  // Jira on: Oriel offers to make the stand-in's issues again in
  // Jira (decision 0059), and both stay until it applies.
  assert.equal((await it.turnOn("jira")).status, 200);
  assert.deepEqual(await kinds(), ["jira", "tracker"]);
  const offer = await moving(it);
  assert.equal((await it.approve(offer.changeSetId)).status, 200);
  assert.deepEqual(
    ["SYN-900", "SYN-901", "SYN-902"].map((key) => it.site?.issue(key)?.summary),
    ["Spring launch", "Pricing page", "Launch email"],
  );
  assert.deepEqual(await kinds(), ["jira"]);

  // Jira turned off: it's on again, with its issues as they were.
  assert.equal((await it.post("/api/actions/source.off", { kind: "jira" })).status, 200);
  await it.app.settled();
  assert.deepEqual(await it.browse(), [["Spring launch", 3]]);
});

test("rejected, Oriel's offer to move the stand-in's issues leaves both trackers on", async (t) => {
  const it = await fresh(t);
  const view = await it.ask("Draft a small launch plan: one epic and a few stories I can edit");
  const entry = view.entries.find((each) => each.kind === "change-set");
  assert.ok(entry?.kind === "change-set");
  await it.approve(entry.changeSetId);
  assert.equal((await it.turnOn("jira")).status, 200);
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
  assert.equal((await it.turnOn("jira")).status, 200);
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

test("a move's revert that deleted nothing in Jira leaves the move as it was", async (t) => {
  const it = await fresh(t);
  const view = await it.ask("Draft a small launch plan: one epic and a few stories I can edit");
  const entry = view.entries.find((each) => each.kind === "change-set");
  assert.ok(entry?.kind === "change-set");
  await it.approve(entry.changeSetId);
  assert.equal((await it.turnOn("jira")).status, 200);
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
  assert.equal((await it.turnOn("jira")).status, 200);
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
