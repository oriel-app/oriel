import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import type { ChangeSetView, DiffView, ThreadSummaryView, ThreadView } from "@oriel/web/view";
import { sendLeaseMs } from "@oriel/changeset";
import { json, type Script, testApp } from "./testing.ts";

const checkout = { kind: "cluster", grouping: "epic", cluster: "10001" };
const unestimated = ["jira:SYN-23", "jira:SYN-99", "jira:SYN-104"];

const estimate: Script = async () => ({
  value: unestimated,
  writes: unestimated.map((id) => ["jira.setEstimate", [id, 3]]),
});

type Acted = { changeSet: ChangeSetView; report?: { applied: string[]; failed: unknown[] } };

async function proposed(t: TestContext, script: Script = estimate) {
  const app = await testApp(t, {
    writes: true,
    plan: () => [{ run: "script" }],
    scripts: { script },
  });
  const site = app.site;
  assert.ok(site);
  const { id: workstreamId } = json<{ id: string }>(await app.post("/api/workstreams", checkout));
  const { id: threadId } = json<{ id: string }>(
    await app.post(`/api/workstreams/${workstreamId}/threads`, { text: "Estimate what's missing" }),
  );
  await app.app.settled();
  const view = async () => json<ThreadView>(await app.get(`/api/threads/${threadId}`));
  const entry = (await view()).entries.find((e) => e.kind === "change-set");
  assert.ok(entry?.kind === "change-set", "the run captured a change set");
  const diff = async (id = entry.changeSetId) =>
    json<DiffView>(await app.post(`/api/change-sets/${id}/diff`));
  const act = async (action: string, body: unknown = {}, id = entry.changeSetId) => {
    const reply = await app.post(`/api/change-sets/${id}/${action}`, body);
    return {
      status: reply.status,
      body: json<Acted & { error?: string; revert?: string; warnings?: string[] }>(reply),
    };
  };
  const approve = async (id = entry.changeSetId) => {
    app.advance(1000);
    return act("approve", { hash: (await diff(id)).hash }, id);
  };
  return {
    ...app,
    site,
    workstreamId,
    threadId,
    view,
    changeSetId: entry.changeSetId,
    diff,
    act,
    approve,
  };
}

test("an applied change set reverts, and the revert is approved like any other", async (t) => {
  const app = await proposed(t);
  await app.approve();
  const reverted = await app.act("revert");
  assert.equal(reverted.status, 200);
  const revertId = reverted.body.revert;
  assert.ok(revertId);
  assert.deepEqual((await app.view()).changeSets.find((s) => s.id === app.changeSetId)?.reverts, [
    revertId,
  ]);
  const undone = await app.approve(revertId);
  assert.equal(undone.body.changeSet.status, "applied");
  for (const id of unestimated) assert.equal(app.site.issue(id.slice(5))?.points, null, id);
});

test("a write the site refuses stops apply partway; retrying applies the rest", async (t) => {
  const app = await proposed(t);
  app.site.refuse("SYN-99");
  const stopped = await app.approve();
  const set = stopped.body.changeSet;
  assert.equal(set.status, "partial");
  const lines = (await app.diff()).lines;
  assert.deepEqual(
    lines.map((l) => [l.applied, l.error !== null]),
    [
      [true, false],
      [false, true],
      [false, false],
    ],
  );
  // Jira answered and changed nothing, so nothing may have landed.
  assert.equal(set.sentUnapplied, false);
  app.site.allow("SYN-99");
  const retried = await app.act("apply");
  assert.equal(retried.body.changeSet.status, "applied");
  assert.equal(app.site.issue("SYN-104")?.points, 3);
});

test("a stopped change can be left out, and the rest approved again", async (t) => {
  const app = await proposed(t);
  app.site.refuse("SYN-99");
  await app.approve();
  const stoppedLine = (await app.diff()).lines[1];
  assert.ok(stoppedLine);
  const edited = await app.act("edit", { remove: [stoppedLine.mutationId] });
  assert.equal(edited.body.changeSet.status, "partial");
  assert.equal((await app.act("apply")).status, 409);
  assert.equal(app.site.issue("SYN-104")?.points, null);
  const rest = await app.approve();
  assert.equal(rest.body.changeSet.status, "applied");
  assert.equal(app.site.issue("SYN-104")?.points, 3);
  assert.equal(app.site.issue("SYN-99")?.points, null);
});

test("what a partial change set applied can be reverted, and the rest is dropped", async (t) => {
  const app = await proposed(t);
  app.site.refuse("SYN-99");
  await app.approve();
  const reverted = await app.act("revert");
  assert.equal(reverted.status, 200);
  assert.equal(reverted.body.changeSet.status, "applied");
  assert.ok(reverted.body.revert);
  await app.approve(reverted.body.revert);
  assert.equal(app.site.issue("SYN-23")?.points, null);
  assert.equal(app.site.issue("SYN-99")?.points, null);
  assert.equal(app.site.issue("SYN-104")?.points, null);
});

test("a write sent with no answer may have landed: revert waits, and a retry finds it", async (t) => {
  const app = await proposed(t);
  app.site.loseAnswers("SYN-99");
  const stopped = await app.approve();
  const set = stopped.body.changeSet;
  assert.equal(set.status, "partial");
  assert.equal(set.sentUnapplied, true);
  // It did land; Oriel can't know that yet.
  assert.equal(app.site.issue("SYN-99")?.points, 3);
  assert.equal((await app.act("revert")).status, 409);
  app.site.allow("SYN-99");
  const retried = await app.act("apply");
  assert.equal(retried.body.changeSet.status, "applied");
  // Found in place and recorded, not sent again.
  const sends = app.site.calls.filter((c) => c.method === "PUT" && c.path.endsWith("/SYN-99"));
  assert.equal(sends.length, 1);
});

test("a change whose item left the workstream since is stopped, and never sent", async (t) => {
  const app = await proposed(t);
  await app.post(`/api/workstreams/${app.workstreamId}/remove`, { items: ["jira:SYN-99"] });
  const stopped = await app.approve();
  assert.equal(stopped.body.changeSet.status, "partial");
  assert.equal(stopped.body.changeSet.sentUnapplied, false);
  assert.equal(app.site.issue("SYN-99")?.points, null);
  await app.act("apply");
  assert.equal(app.site.issue("SYN-99")?.points, null);
});

test("of two change sets awaiting review, approving the later keeps the thread in Needs you for the earlier", async (t) => {
  const app = await proposed(t);
  app.advance(1000);
  await app.post(`/api/threads/${app.threadId}/messages`, { text: "And the rest?" });
  await app.app.settled();
  const later = (await app.view()).changeSets.find((set) => set.id !== app.changeSetId);
  assert.equal(later?.status, "open");
  const waiting = async () =>
    json<{ threads: ThreadSummaryView[] }>(await app.get("/api/threads")).threads.find(
      (thread) => thread.id === app.threadId,
    )?.waitingOn;
  assert.equal((await app.approve(later.id)).body.changeSet.status, "applied");
  assert.deepEqual([(await app.view()).state, await waiting()], ["working", "review"]);
  assert.equal((await app.approve()).body.changeSet.status, "applied");
  assert.deepEqual([(await app.view()).state, await waiting()], ["done", null]);
});

test("while a change set applies, nothing is offered for it and every action waits", async (t) => {
  const app = await proposed(t);
  const ids = (await app.diff()).lines.map((line) => line.mutationId);
  const held = app.site.hold("SYN-99");
  const approving = app.approve();
  await held.reached;
  const set = (await app.view()).changeSets.find((s) => s.id === app.changeSetId);
  assert.equal(set?.status, "applying");
  assert.deepEqual(set?.nextSteps, []);
  const { hash } = await app.diff();
  for (const [action, body] of [
    ["apply", {}],
    ["dismiss", {}],
    ["revert", {}],
    ["reject", { hash }],
    ["edit", { remove: [ids[2]] }],
  ] as const)
    assert.equal((await app.act(action, body)).status, 409, action);
  held.release();
  const applied = await approving;
  assert.equal(applied.body.changeSet.status, "applied");
  for (const id of unestimated) assert.equal(app.site.issue(id.slice(5))?.points, 3, id);
});

test("a folder connected while a change set applies leaves it applying, with its writer, until its write lands", async (t) => {
  const app = await proposed(t);
  const notes = realpathSync(mkdtempSync(join(tmpdir(), "oriel-server-writes-")));
  t.after(() => rmSync(notes, { recursive: true, force: true }));
  writeFileSync(join(notes, "Plan.md"), "Ship it.");
  const held = app.site.hold("SYN-99");
  const approving = app.approve();
  await held.reached;
  assert.equal((await app.connect("folder", { path: notes })).status, 200);
  const set = (await app.view()).changeSets.find((s) => s.id === app.changeSetId);
  assert.equal(set?.status, "applying");
  assert.equal((await app.act("dismiss")).status, 409);
  held.release();
  assert.equal((await approving).body.changeSet.status, "applied");
});

test("a change set whose apply stalls on its source shows stalled, back in Needs you, until it moves", async (t) => {
  const app = await proposed(t);
  const held = app.site.hold("SYN-99");
  const approving = app.approve();
  await held.reached;
  const summary = async () =>
    json<{ threads: ThreadSummaryView[] }>(await app.get("/api/threads")).threads.find(
      (thread) => thread.id === app.threadId,
    );
  const set = async () => (await app.view()).changeSets.find((s) => s.id === app.changeSetId);
  assert.equal((await summary())?.waitingOn, "apply");
  assert.equal((await set())?.stalled, false);
  app.advance(sendLeaseMs);
  assert.equal((await summary())?.waitingOn, "stalled");
  assert.deepEqual(
    [(await set())?.stalled, (await set())?.status, (await set())?.nextSteps],
    [true, "applying", []],
  );
  held.release();
  const applied = await approving;
  assert.equal(applied.body.changeSet.stalled, false);
  assert.notEqual((await summary())?.waitingOn, "stalled");
});

test("a partly applied change set's review link can't reject it, dismisses only the diff it saw, and dies with the decision", async (t) => {
  const app = await proposed(t);
  app.site.refuse("SYN-99");
  await app.approve();
  const stopped = (await app.diff()).lines[1];
  assert.ok(stopped);
  await app.act("edit", { remove: [stopped.mutationId] });
  const minted = json<{ url: string }>(
    await app.post(`/api/change-sets/${app.changeSetId}/review-link`),
  );
  const token = new URL(minted.url).pathname.split("/").at(-1);
  const opened = json<{ diff: DiffView }>(await app.post("/api/review/open", { token }));
  const rejected = await app.post("/api/review/decide", {
    token,
    changeSet: app.changeSetId,
    kind: "rejected",
    name: "Ana",
    hash: opened.diff.hash,
  });
  assert.equal(rejected.status, 409);
  const dismiss = (hash: string) =>
    app.post("/api/review/dismiss", { token, changeSet: app.changeSetId, name: "Ana", hash });
  assert.equal((await dismiss("not-the-diff")).status, 409);
  assert.equal((await dismiss(opened.diff.hash)).status, 200);
  assert.equal((await dismiss(opened.diff.hash)).status, 409);
});

const finish: Script = async () => ({
  value: null,
  writes: [["jira.setStatus", ["jira:SYN-99", "Done"]]],
});

test("a move the workflow has no way to is flagged in the diff, can't be approved, and moves nothing", async (t) => {
  const app = await proposed(t, finish);
  await app.approve();
  app.site.makeFinal("Done");
  const revertId = (await app.act("revert")).body.revert;
  assert.ok(revertId);
  const [line] = (await app.diff(revertId)).lines;
  assert.ok(line?.check && "refused" in line.check, "the diff says Jira won't take it");
  const approved = await app.approve(revertId);
  assert.equal(approved.status, 409);
  assert.equal(app.site.issue("SYN-99")?.status, "Done");
});

const moveBetween: Script = async () => ({
  value: null,
  writes: [
    ["jira.setEstimate", ["jira:SYN-23", 3]],
    ["jira.setStatus", ["jira:SYN-99", "Done"]],
    ["jira.setEstimate", ["jira:SYN-104", 3]],
  ],
});

test("a move the workflow refuses once approved stops the set for good: no retry, and dismissing ends it", async (t) => {
  const app = await proposed(t, moveBetween);
  const { hash } = await app.diff();
  // The workflow changed between the diff and the apply.
  app.site.makeFinal("To Do");
  const stopped = (await app.act("approve", { hash })).body.changeSet;
  assert.equal(stopped.status, "partial");
  assert.equal(app.site.issue("SYN-104")?.points, null, "nothing after it was sent");
  const kinds = stopped.nextSteps.map((step) => step.kind);
  assert.ok(!kinds.includes("retry"), "trying again can't help");
  assert.ok(kinds.includes("remove") && kinds.includes("dismiss"));
  assert.equal((await app.act("apply")).status, 409);
  const waiting = async () =>
    json<{ threads: ThreadSummaryView[] }>(await app.get("/api/threads")).threads.find(
      (each) => each.id === app.threadId,
    )?.waitingOn;
  assert.equal(await waiting(), "review");
  const dismissed = await app.act("dismiss");
  assert.equal(dismissed.status, 200);
  assert.equal(dismissed.body.changeSet.decision?.kind, "rejected");
  assert.deepEqual(
    dismissed.body.changeSet.nextSteps.map((step) => step.kind),
    ["revert"],
  );
  const lines = (await app.diff()).lines;
  assert.deepEqual(
    lines.map((line) => [line.applied, line.dismissed, line.error]),
    [
      [true, false, null],
      [false, true, null],
      [false, true, null],
    ],
  );
  assert.notEqual(await waiting(), "review");
});

test("a set that may have landed partway is dismissed, and shows, while its source can't be read", async (t) => {
  const app = await proposed(t);
  app.site.loseAnswers("SYN-99");
  await app.approve();
  app.site.outage("offline");
  const before = (await app.view()).changeSets.find((s) => s.id === app.changeSetId);
  const offered = before?.nextSteps.find((step) => step.kind === "dismiss");
  assert.ok(offered?.kind === "dismiss" && offered.warnings.length === 1);
  const dismissed = await app.act("dismiss");
  assert.equal(dismissed.status, 200);
  assert.ok(!dismissed.body.changeSet.nextSteps.some((step) => step.kind === "dismiss"));
  const shown = await app.post(`/api/change-sets/${app.changeSetId}/diff`);
  assert.equal(shown.status, 200);
  assert.equal(json<DiffView>(shown).lines.length, 3);
});
