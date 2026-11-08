// A comment on a Jira issue through a change set: approving posts it and
// leaves the description alone, and a revert deletes it, or stops when a
// teammate edited it since. Jira is SYN in memory.
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import type { ChangeSetView, DiffView, ThreadView } from "@oriel/web/view";
import { json, type Script, testApp } from "./testing.ts";

const note = "The launch moved to 14 August: the operator's crew rota slipped a fortnight.";
const comment: Script = async () => ({
  value: null,
  writes: [["jira.addComment", ["jira:SYN-45", note]]],
});

type Acted = { changeSet: ChangeSetView; error?: string; revert?: string };

async function proposed(t: TestContext) {
  const app = await testApp(t, {
    memory: true,
    plan: () => [{ run: "comment" }],
    scripts: { comment },
  });
  const { site } = app;
  assert.ok(site);
  const { id: workstreamId } = json<{ id: string }>(
    await app.post("/api/workstreams", { kind: "picked", name: "Fares", items: ["jira:SYN-45"] }),
  );
  const { id: threadId } = json<{ id: string }>(
    await app.post(`/api/workstreams/${workstreamId}/threads`, { text: "Note the date move" }),
  );
  await app.app.settled();
  const view = async () => json<ThreadView>(await app.get(`/api/threads/${threadId}`));
  const entry = (await view()).entries.find((e) => e.kind === "change-set");
  assert.ok(entry?.kind === "change-set", "the run captured a change set");
  const diff = async (id = entry.changeSetId) =>
    json<DiffView>(await app.post(`/api/change-sets/${id}/diff`));
  const act = async (action: string, body: unknown = {}, id = entry.changeSetId) =>
    json<Acted>(await app.post(`/api/change-sets/${id}/${action}`, body));
  const approve = async (id = entry.changeSetId) => {
    app.advance(1000);
    return act("approve", { hash: (await diff(id)).hash }, id);
  };
  return { ...app, site, threadId, view, diff, act, approve, changeSetId: entry.changeSetId };
}

test("an approved comment is posted on the issue, the description untouched, and a revert deletes it", async (t) => {
  const app = await proposed(t);
  const description = app.site.issue("SYN-45")?.description;
  // Nothing reaches Jira before the approval.
  assert.equal(app.site.issue("SYN-45")?.comments.length, 0);
  assert.equal((await app.approve()).changeSet.status, "applied");
  assert.deepEqual(
    app.site.issue("SYN-45")?.comments.map((c) => c.body),
    [note],
  );
  assert.equal(app.site.issue("SYN-45")?.description, description);

  const { revert } = await app.act("revert");
  assert.ok(revert);
  assert.equal((await app.approve(revert)).changeSet.status, "applied");
  assert.deepEqual(app.site.issue("SYN-45")?.comments, []);
  assert.equal(app.site.issue("SYN-45")?.description, description);
});

test("a revert stops, deleting nothing, when a teammate edited the comment since", async (t) => {
  const app = await proposed(t);
  await app.approve();
  const [posted] = app.site.issue("SYN-45")?.comments ?? [];
  assert.ok(posted);
  app.site.editComment("SYN-45", posted.id, "The launch moved to 21 August.");
  const stopped = await app.act("revert");
  assert.equal(stopped.revert, undefined);
  assert.ok(stopped.error);
  assert.deepEqual(
    app.site.issue("SYN-45")?.comments.map((c) => c.body),
    ["The launch moved to 21 August."],
  );
});
