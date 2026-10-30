// The write path, end to end through the routes: change sets write to SYN as
// a Jira site in memory, through the writer @oriel/changeset builds.
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import type { ChangeSetView, DiffView, GroupView, ThreadView } from "@oriel/web/view";
import { json, type Script, testApp } from "./testing.ts";

// SYN-1's epic, whose stories SYN-23, SYN-99 and SYN-104 have no estimate.
const checkout = { kind: "cluster", grouping: "epic", cluster: "10001" };
const unestimated = ["jira:SYN-23", "jira:SYN-99", "jira:SYN-104"];

const estimate: Script = async () => ({
  value: unestimated,
  writes: unestimated.map((id) => ["jira.setEstimate", [id, 3]]),
});
const create: Script = async () => ({
  value: null,
  writes: [["jira.createStory", [{ summary: "Pay with a gift card" }], "new:1"]],
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
  const { id: groupId } = json<{ id: string }>(await app.post("/api/groups", checkout));
  const { id: threadId } = json<{ id: string }>(
    await app.post(`/api/groups/${groupId}/threads`, { text: "Estimate what's missing" }),
  );
  await app.app.settled();
  const view = async () => json<ThreadView>(await app.get(`/api/threads/${threadId}`));
  const entry = (await view()).entries.find((e) => e.kind === "change-set");
  assert.ok(entry?.kind === "change-set", "the run captured a change set");
  const diff = async (id = entry.changeSetId) =>
    json<DiffView>(await app.post(`/api/change-sets/${id}/diff`));
  const act = async (action: string, body: unknown = {}, id = entry.changeSetId) => {
    const reply = await app.post(`/api/change-sets/${id}/${action}`, body);
    return { status: reply.status, body: json<Acted & { error?: string; revert?: string }>(reply) };
  };
  // Approving what the diff shows now, a moment later than the last message.
  const approve = async (id = entry.changeSetId) => {
    app.advance(1000);
    return act("approve", { hash: (await diff(id)).hash }, id);
  };
  return {
    ...app,
    site,
    groupId,
    threadId,
    view,
    changeSetId: entry.changeSetId,
    diff,
    act,
    approve,
  };
}

test("approving applies through the writer, and the thread is done", async (t) => {
  const app = await proposed(t);
  assert.equal((await app.view()).writable, true);
  const approved = await app.approve();
  assert.equal(approved.status, 200);
  assert.equal(approved.body.changeSet.status, "applied");
  assert.equal(approved.body.report?.applied.length, 3);
  for (const id of unestimated) assert.equal(app.site.issue(id.slice(5))?.points, 3, id);
  const thread = await app.view();
  assert.deepEqual([thread.state, thread.doneBy], ["done", "applied"]);
  const names = app.app.telemetry().map((e) => e.name);
  assert.ok(names.includes("changeset.decided"));
  assert.ok(names.includes("changeset.applied"));
});

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
  assert.equal(stopped.body.changeSet.status, "partial");
  assert.equal(stopped.body.changeSet.approved, true);
  assert.equal(stopped.body.changeSet.errors.length, 1);
  assert.match(stopped.body.changeSet.errors[0]?.error ?? "", /SYN-99 can't be changed right now/);
  const lines = (await app.diff()).lines;
  assert.deepEqual(
    lines.map((l) => [l.applied, l.error !== null, l.removable]),
    [
      [true, false, false],
      [false, true, true],
      [false, false, false],
    ],
  );
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
  assert.ok(stoppedLine?.removable);
  const edited = await app.act("edit", { remove: [stoppedLine.mutationId] });
  // The edit voids the approval; what's left needs approving again.
  assert.deepEqual(
    [edited.body.changeSet.status, edited.body.changeSet.approved],
    ["partial", false],
  );
  const rest = await app.approve();
  assert.equal(rest.body.changeSet.status, "applied");
  assert.equal(app.site.issue("SYN-104")?.points, 3);
  assert.equal(app.site.issue("SYN-99")?.points, null);
});

test("what a partial change set applied can be reverted, and the rest is dropped", async (t) => {
  const app = await proposed(t);
  app.site.refuse("SYN-99");
  await app.approve();
  // A change that was sent may have landed, so revert waits for it.
  const blocked = await app.act("revert");
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error ?? "", /may have landed/);
  const stoppedLine = (await app.diff()).lines[1];
  assert.ok(stoppedLine);
  await app.act("edit", { remove: [stoppedLine.mutationId] });
  const reverted = await app.act("revert");
  assert.equal(reverted.status, 200);
  assert.equal(reverted.body.changeSet.status, "applied");
  assert.ok(reverted.body.revert);
  await app.approve(reverted.body.revert);
  assert.equal(app.site.issue("SYN-23")?.points, null);
  assert.equal(app.site.issue("SYN-104")?.points, null);
});

test("a change whose item left the group since is stopped, and can be left out", async (t) => {
  const app = await proposed(t);
  await app.post(`/api/groups/${app.groupId}/remove`, { items: ["jira:SYN-99"] });
  const stopped = await app.approve();
  assert.equal(stopped.body.changeSet.status, "partial");
  assert.match(
    stopped.body.changeSet.errors[0]?.error ?? "",
    /SYN-99 was removed from the group after this was captured/,
  );
  assert.equal(stopped.body.changeSet.sentUnapplied, false);
  assert.equal(app.site.issue("SYN-99")?.points, null);
  const line = (await app.diff()).lines.find((l) => l.error !== null);
  assert.ok(line?.removable);
  await app.act("edit", { remove: [line.mutationId] });
  assert.equal((await app.approve()).body.changeSet.status, "applied");
});

test("an item a change set creates joins the group, with markers in its threads", async (t) => {
  const app = await proposed(t, create);
  // Another thread on the group, still working when the change set applies.
  const { id: other } = json<{ id: string }>(
    await app.post(`/api/groups/${app.groupId}/threads`, {}),
  );
  const applied = await app.approve();
  assert.equal(applied.body.changeSet.status, "applied");
  const made = [...app.site.calls].reverse().find((c) => c.method === "POST")?.path;
  assert.equal(made, "/rest/api/3/issue");
  const group = json<GroupView>(await app.get(`/api/groups/${app.groupId}`));
  assert.equal(group.group.version, 2);
  assert.equal(group.changes[0]?.cause, "change-set");
  const key = group.changes[0]?.added[0]?.key;
  assert.equal(key, "SYN-900");
  assert.equal(app.site.issue("SYN-900")?.epic, "SYN-1");
  const markerOf = (thread: ThreadView) => {
    const marker = thread.entries.findLast((e) => e.kind === "marker");
    return marker?.kind === "marker" ? marker.added.map((r) => r.key) : null;
  };
  // The working thread follows the group at once.
  const working = json<ThreadView>(await app.get(`/api/threads/${other}`));
  assert.deepEqual([working.regionVersion, markerOf(working)], [2, ["SYN-900"]]);
  // The thread the change set settled keeps its version until the user writes.
  const settled = await app.view();
  assert.deepEqual([settled.state, settled.regionVersion, markerOf(settled)], ["done", 1, null]);
  await app.post(`/api/threads/${app.threadId}/messages`, { text: "And the new one?" });
  await app.app.settled();
  const caught = await app.view();
  assert.deepEqual([caught.regionVersion, markerOf(caught)], [2, ["SYN-900"]]);
  assert.ok(caught.members.some((m) => m.ref.key === "SYN-900"));
  const added = app.app.telemetry().find((e) => e.name === "group.item-added");
  assert.equal(added?.data.cause, "change-set");
});

test("a review link approves and applies, and says what happened", async (t) => {
  const app = await proposed(t);
  app.site.refuse("SYN-99");
  const minted = json<{ url: string }>(
    await app.post(`/api/change-sets/${app.changeSetId}/review-link`),
  );
  const token = new URL(minted.url).pathname.split("/").at(-1);
  const opened = json<{ diff: DiffView }>(await app.post("/api/review/open", { token }));
  const decided = json<{ changeSet: ChangeSetView }>(
    await app.post("/api/review/decide", {
      token,
      changeSet: app.changeSetId,
      kind: "approved",
      name: "Ana",
      hash: opened.diff.hash,
    }),
  );
  assert.equal(decided.changeSet.status, "partial");
  assert.equal(decided.changeSet.errors.length, 1);
  assert.equal(decided.changeSet.decision?.by, "Ana");
});
