// The write path, end to end through the routes: change sets write to SYN as
// a Jira site in memory, through the writer @oriel/changeset builds.
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import type { ChangeSetView, DiffView, GroupView, StreamEvent, ThreadView } from "@oriel/web/view";
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
    return {
      status: reply.status,
      body: json<Acted & { error?: string; revert?: string; warnings?: string[] }>(reply),
    };
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

test("a thread from nothing plans an epic and its stories, and its new group takes the epic's name", async (t) => {
  const plan: Script = async () => ({
    value: null,
    writes: [
      ["jira.createEpic", [{ summary: "Kiosk wallets" }], "new:1"],
      ["jira.createStory", [{ summary: "Tap to pay", epic: "new:1" }], "new:2"],
    ],
  });
  const app = await testApp(t, { writes: true, plan: () => [{ run: "plan" }], scripts: { plan } });
  const started = await app.post("/api/threads", { text: "Plan kiosk wallets" });
  assert.equal(started.status, 201);
  const { id: threadId, groupId } = json<{ id: string; groupId: string }>(started);
  await app.app.settled();
  const group = async () => json<GroupView>(await app.get(`/api/groups/${groupId}`));
  const before = await group();
  assert.deepEqual([before.group.name, before.members.length], ["New group", 0]);
  assert.deepEqual(
    app.app
      .telemetry()
      .filter((e) => e.name === "group.created" || e.name === "thread.opened")
      .map(({ name, data }) =>
        name === "group.created" ? [name, data.origin, data.size] : [name, data.regionSize],
      ),
    [
      ["group.created", "picked", 0],
      ["thread.opened", 0],
    ],
  );

  const view = json<ThreadView>(await app.get(`/api/threads/${threadId}`));
  const entry = view.entries.find((e) => e.kind === "change-set");
  assert.ok(entry?.kind === "change-set", "the run captured a change set");
  const diff = json<DiffView>(await app.post(`/api/change-sets/${entry.changeSetId}/diff`));
  assert.deepEqual(
    diff.lines.map((line) => line.sentence),
    [
      "Create an epic “Kiosk wallets”.",
      "Create a story “Tap to pay” in the new epic “Kiosk wallets”.",
    ],
  );
  assert.deepEqual(diff.lines[1]?.fields.find((f) => f.name === "epic")?.after, "created above");
  app.advance(1000);
  const approved = await app.post(`/api/change-sets/${entry.changeSetId}/approve`, {
    hash: diff.hash,
  });
  assert.equal(json<Acted>(approved).changeSet.status, "applied");

  const after = await group();
  assert.equal(after.group.name, "Kiosk wallets");
  const [epic, story] = after.members.map((m) => m.ref.key);
  assert.ok(epic && story);
  assert.equal(app.site?.issue(epic)?.issueType, "Epic");
  assert.equal(app.site?.issue(story)?.epic, epic);
});

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
  const set = stopped.body.changeSet;
  assert.equal(set.status, "partial");
  assert.deepEqual(
    set.errors.map((e) => e.error),
    ["The source refused this change: SYN-99 can't be changed right now."],
  );
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
  // What the engine says can be done, and the window shows nothing else.
  assert.deepEqual(set.nextSteps, [
    { kind: "retry" },
    { kind: "remove", mutationIds: [lines[1]?.mutationId, lines[2]?.mutationId] },
    { kind: "dismiss", warnings: [] },
    { kind: "revert" },
  ]);
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
  // The edit voids the approval; what's left needs approving again, once a
  // diff has shown it.
  assert.equal(edited.body.changeSet.status, "partial");
  assert.deepEqual(
    edited.body.changeSet.nextSteps.map((s) => s.kind),
    ["remove", "dismiss", "revert"],
  );
  await app.diff();
  const shown = (await app.view()).changeSets.find((s) => s.id === app.changeSetId);
  assert.deepEqual(
    shown?.nextSteps.map((s) => s.kind),
    ["approve-rest", "remove", "dismiss", "revert"],
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
  assert.deepEqual(
    set.errors.map((e) => [e.error, e.sent]),
    [["Oriel sent this and didn't hear back.", true]],
  );
  // It did land; Oriel can't know that yet.
  assert.equal(app.site.issue("SYN-99")?.points, 3);
  assert.deepEqual(
    set.nextSteps.map((step) => step.kind),
    ["retry", "remove", "dismiss"],
  );
  const blocked = await app.act("revert");
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error ?? "", /may have landed/);
  app.site.allow("SYN-99");
  const retried = await app.act("apply");
  assert.equal(retried.body.changeSet.status, "applied");
  // Found in place and recorded, not sent again.
  const sends = app.site.calls.filter((c) => c.method === "PUT" && c.path.endsWith("/SYN-99"));
  assert.equal(sends.length, 1);
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
  assert.ok(line);
  // Trying again would stop at it again, so it isn't offered.
  const steps = stopped.body.changeSet.nextSteps;
  assert.deepEqual(
    steps.map((s) => s.kind),
    ["remove", "dismiss", "revert"],
  );
  assert.ok(steps.some((s) => s.kind === "remove" && s.mutationIds.includes(line.mutationId)));
  await app.act("edit", { remove: [line.mutationId] });
  assert.equal((await app.approve()).body.changeSet.status, "applied");
});

test("leaving out the last unapplied change completes the set, and the thread is done from then", async (t) => {
  const two: Script = async () => ({
    value: null,
    writes: [
      ["jira.setEstimate", ["jira:SYN-23", 3]],
      ["jira.setEstimate", ["jira:SYN-99", 3]],
    ],
  });
  const app = await proposed(t, two);
  app.site.refuse("SYN-99");
  await app.approve();
  // The user writes after the partial apply; the set isn't done, nor the thread.
  app.advance(1000);
  await app.post(`/api/threads/${app.threadId}/messages`, { text: "What stopped?" });
  await app.app.settled();
  assert.equal((await app.view()).state, "working");
  app.advance(1000);
  const line = (await app.diff()).lines[1];
  assert.ok(line);
  const edited = await app.act("edit", { remove: [line.mutationId] });
  assert.equal(edited.body.changeSet.status, "applied");
  // Done as of the edit that completed it, not as of the apply before the message.
  const thread = await app.view();
  assert.deepEqual([thread.state, thread.doneBy], ["done", "applied"]);
  const applied = app.app.telemetry().filter((e) => e.name === "changeset.applied");
  assert.equal(applied.length, 1);
});

test("a revert that drops unsent changes completes the set it reverts", async (t) => {
  const app = await proposed(t);
  await app.post(`/api/groups/${app.groupId}/remove`, { items: ["jira:SYN-99"] });
  await app.approve();
  app.advance(1000);
  const reverted = await app.act("revert");
  assert.equal(reverted.body.changeSet.status, "applied");
  assert.equal(app.app.telemetry().filter((e) => e.name === "changeset.applied").length, 1);
  assert.deepEqual((await app.view()).state, "done");
});

test("a change set that can go no further is dismissed, with what to check", async (t) => {
  const app = await proposed(t);
  app.site.loseAnswers("SYN-99");
  await app.approve();
  const dismissed = await app.act("dismiss");
  assert.equal(dismissed.status, 200);
  assert.deepEqual(dismissed.body.warnings, ["This may already be in Jira: check SYN-99"]);
  assert.equal(dismissed.body.changeSet.decision?.kind, "rejected");
  // What applied stays, and a revert covers exactly that.
  assert.deepEqual(dismissed.body.changeSet.nextSteps, [{ kind: "revert" }]);
  assert.equal((await app.act("apply")).status, 409);
  // A dismissal, not a rejection.
  const names = app.app.telemetry().map((e) => [e.name, e.data.decision]);
  assert.deepEqual(
    names.filter(([name]) => name === "changeset.dismissed" || name === "changeset.decided"),
    [
      ["changeset.decided", "approved"],
      ["changeset.dismissed", undefined],
    ],
  );
  const reverted = await app.act("revert");
  assert.equal(reverted.status, 200);
});

test("while a change set applies, nothing is offered for it and every action waits", async (t) => {
  const app = await proposed(t);
  const ids = (await app.diff()).lines.map((line) => line.mutationId);
  // Another tab, watching the thread.
  const watching = (await app.get(`/api/threads/${app.threadId}/events`)).stream;
  assert.ok(watching);
  const events = watching[Symbol.asyncIterator]();
  const changed = async () => {
    for (;;) {
      const next = await events.next();
      assert.ok(!next.done);
      const data = /^data: (.*)$/m.exec(next.value)?.[1];
      const event = data === undefined ? null : (JSON.parse(data) as StreamEvent);
      if (event?.type === "change-set") return event.changeSetId;
    }
  };
  const held = app.site.hold("SYN-99");
  const approving = app.approve();
  await held.reached;
  // It hears that the apply started, and sees only that.
  assert.equal(await changed(), app.changeSetId);
  const set = (await app.view()).changeSets.find((s) => s.id === app.changeSetId);
  assert.equal(set?.applying, true);
  assert.equal(set?.status, "applying");
  assert.deepEqual(set?.nextSteps, []);
  // The write in flight is no stop: nothing says why it stopped, or to try again.
  assert.deepEqual(set?.errors, []);
  assert.ok((await app.diff()).lines.every((line) => line.error === null));
  const { hash } = await app.diff();
  for (const [action, body] of [
    ["apply", {}],
    ["dismiss", {}],
    ["revert", {}],
    ["reject", { hash }],
    ["edit", { remove: [ids[2]] }],
  ] as const) {
    const refused = await app.act(action, body);
    assert.equal(refused.status, 409, action);
    assert.match(refused.body.error ?? "", /being applied/, action);
  }
  held.release();
  const applied = await approving;
  // And that it ended.
  assert.equal(await changed(), app.changeSetId);
  await events.return?.();
  assert.equal(applied.body.changeSet.status, "applied");
  assert.equal(applied.body.changeSet.applying, false);
  assert.deepEqual(applied.body.changeSet.nextSteps, [{ kind: "revert" }]);
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

test("a partly applied change set's review link offers what the engine does, dismiss included", async (t) => {
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
  const opened = json<{ changeSet: ChangeSetView; diff: DiffView }>(
    await app.post("/api/review/open", { token }),
  );
  assert.deepEqual(
    opened.changeSet.nextSteps.map((s) => s.kind),
    ["approve-rest", "remove", "dismiss", "revert"],
  );
  // Part of it applied, so it can't be rejected: the page doesn't offer it.
  const rejected = await app.post("/api/review/decide", {
    token,
    changeSet: app.changeSetId,
    kind: "rejected",
    name: "Ana",
    hash: opened.diff.hash,
  });
  assert.equal(rejected.status, 409);
  // A dismissal is of the diff the reviewer saw: a stale one is refused.
  const stale = await app.post("/api/review/dismiss", {
    token,
    changeSet: app.changeSetId,
    name: "Ana",
    hash: "not-the-diff",
  });
  assert.equal(stale.status, 409);
  // Another tab, watching the thread, hears of it.
  const watching = (await app.get(`/api/threads/${app.threadId}/events`)).stream;
  assert.ok(watching);
  const events = watching[Symbol.asyncIterator]();
  const dismissed = json<{ changeSet: ChangeSetView; warnings: string[] }>(
    await app.post("/api/review/dismiss", {
      token,
      changeSet: app.changeSetId,
      name: "Ana",
      hash: opened.diff.hash,
    }),
  );
  for (;;) {
    const next = await events.next();
    assert.ok(!next.done);
    const data = /^data: (.*)$/m.exec(next.value)?.[1];
    const heard = data === undefined ? null : (JSON.parse(data) as StreamEvent);
    if (heard?.type !== "change-set") continue;
    assert.deepEqual(heard, { type: "change-set", changeSetId: app.changeSetId, applying: false });
    break;
  }
  await events.return?.();
  assert.deepEqual(dismissed.warnings, []);
  assert.deepEqual(
    [dismissed.changeSet.decision?.kind, dismissed.changeSet.decision?.via],
    ["rejected", "review-link"],
  );
  assert.equal(dismissed.changeSet.decision?.by, "Ana");
  assert.deepEqual(dismissed.changeSet.nextSteps, [{ kind: "revert" }]);
  const event = app.app.telemetry().find((e) => e.name === "changeset.dismissed");
  assert.equal(event?.data.via, "review-link");
  // The link died with the decision.
  const again = await app.post("/api/review/dismiss", {
    token,
    changeSet: app.changeSetId,
    name: "Ana",
    hash: opened.diff.hash,
  });
  assert.equal(again.status, 409);
});

// The next `change-set` event on a thread's stream.
async function told(events: AsyncIterator<string>) {
  for (;;) {
    const next = await events.next();
    assert.ok(!next.done, "the stream ended early");
    const data = /^data: (.*)$/m.exec(next.value)?.[1];
    const event = data === undefined ? null : (JSON.parse(data) as StreamEvent);
    if (event?.type === "change-set") return event;
  }
}

test("every action that changes a change set tells the thread's stream", async (t) => {
  const app = await proposed(t);
  app.site.refuse("SYN-99");
  await app.approve();
  const watching = (await app.get(`/api/threads/${app.threadId}/events`)).stream;
  assert.ok(watching);
  const events = watching[Symbol.asyncIterator]();
  const changed = { type: "change-set", changeSetId: app.changeSetId, applying: false };
  const stopped = (await app.diff()).lines[1];
  assert.ok(stopped);
  assert.equal((await app.act("edit", { remove: [stopped.mutationId] })).status, 200);
  assert.deepEqual(await told(events), changed);
  assert.equal((await app.act("dismiss")).status, 200);
  assert.deepEqual(await told(events), changed);
  await events.return?.();
});

test("a review link's rejection tells the thread's stream", async (t) => {
  const app = await proposed(t);
  const minted = json<{ url: string }>(
    await app.post(`/api/change-sets/${app.changeSetId}/review-link`),
  );
  const token = new URL(minted.url).pathname.split("/").at(-1);
  const opened = json<{ diff: DiffView }>(await app.post("/api/review/open", { token }));
  const watching = (await app.get(`/api/threads/${app.threadId}/events`)).stream;
  assert.ok(watching);
  const events = watching[Symbol.asyncIterator]();
  const rejected = await app.post("/api/review/decide", {
    token,
    changeSet: app.changeSetId,
    kind: "rejected",
    name: "Ana",
    hash: opened.diff.hash,
  });
  assert.equal(rejected.status, 200);
  assert.deepEqual(await told(events), {
    type: "change-set",
    changeSetId: app.changeSetId,
    applying: false,
  });
  await events.return?.();
});
