// Syncing Jira against a live site: a sync that didn't finish marks nothing
// gone, and what a revert deleted doesn't come back while Jira's search lags.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChangeSetView, DiffView, WorkstreamView, ThreadView } from "@oriel/web/view";
import { json, type Script, testApp } from "./testing.ts";

const keys = (app: Awaited<ReturnType<typeof testApp>>) =>
  new Set(
    app.app
      .window("epic")
      .clusters.flatMap((c) => [c.row.anchor?.key, ...c.list.map((r) => r.key)]),
  );

test("a Sync that fails partway marks nothing gone, and the next one does", async (t) => {
  const app = await testApp(t, { live: true });
  const { site } = app;
  assert.ok(site);
  site.remove("SYN-21");
  // The first page of the listing arrives; then the network goes.
  const search = site.hold("search");
  const reply = app.sync("jira");
  await search.reached;
  site.outage("offline");
  search.release();
  assert.equal((await reply).status, 502);
  assert.ok(keys(app).has("SYN-21"), "a sweep that didn't finish can't say what's gone");
  site.outage(null);
  assert.equal((await app.sync("jira")).status, 200);
  assert.ok(!keys(app).has("SYN-21"));
});

const plan: Script = async () => ({
  value: null,
  writes: [["jira.createEpic", [{ summary: "Kiosk wallets" }], "new:1"]],
});

test("what a revert deleted stays gone while Jira's search lags, however long", async (t) => {
  const app = await testApp(t, { live: true, plan: () => [{ run: "plan" }], scripts: { plan } });
  const { site } = app;
  assert.ok(site);
  const { id: threadId, workstreamId } = json<{ id: string; workstreamId: string }>(
    await app.post("/api/threads", { text: "Plan kiosk wallets" }),
  );
  await app.app.settled();
  const entry = json<ThreadView>(await app.get(`/api/threads/${threadId}`)).entries.find(
    (e) => e.kind === "change-set",
  );
  assert.ok(entry?.kind === "change-set");
  const approve = async (id: string) => {
    const { hash } = json<DiffView>(await app.post(`/api/change-sets/${id}/diff`));
    app.advance(1000);
    return json<{ changeSet: ChangeSetView; revert?: string }>(
      await app.post(`/api/change-sets/${id}/approve`, { hash }),
    );
  };
  assert.equal((await approve(entry.changeSetId)).changeSet.status, "applied");
  assert.ok(keys(app).has("SYN-900"));

  // The search lists the epic, and goes on listing it once a revert deletes it.
  const { revert } = json<{ revert?: string }>(
    await app.post(`/api/change-sets/${entry.changeSetId}/revert`, {}),
  );
  assert.ok(revert);
  site.searchLags();
  assert.equal((await approve(revert)).changeSet.status, "applied");
  assert.equal(site.issue("SYN-900"), null);
  assert.ok(!keys(app).has("SYN-900"));

  // Long after the app stopped reading the epic by key, a sync of each kind:
  // one a dropped link starts, then a Sync.
  app.advance(60 * 60 * 1000);
  const drop = await app.post(`/api/workstreams/${workstreamId}/drop`, {
    links: ["https://oriel.atlassian.net/browse/SYN-999"],
    files: [],
  });
  assert.equal(drop.status, 200);
  assert.ok(!keys(app).has("SYN-900"), "an incremental sync doesn't bring it back");
  assert.equal((await app.sync("jira")).status, 200);
  assert.ok(!keys(app).has("SYN-900"), "nor does a full sweep");
  const members = json<WorkstreamView>(await app.get(`/api/workstreams/${workstreamId}`)).members;
  assert.deepEqual(
    members.map((m) => [m.ref.key, m.row]),
    [["SYN-900", null]],
  );
});
