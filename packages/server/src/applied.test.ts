// After an apply against a live site: what the change set wrote shows at
// once, though Jira's search catches up with writes only a while later.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChangeSetView, DiffView, GroupView, ThreadView } from "@oriel/web/view";
import { json, type Script, testApp } from "./testing.ts";

const plan: Script = async () => ({
  value: null,
  writes: [
    ["jira.createEpic", [{ summary: "Kiosk wallets" }], "new:1"],
    ["jira.createStory", [{ summary: "Tap to pay", epic: "new:1" }], "new:2"],
  ],
});

type Acted = { changeSet: ChangeSetView; revert?: string };

test("what a change set creates shows with its title at once, and goes when a revert deletes it", async (t) => {
  const app = await testApp(t, { live: true, plan: () => [{ run: "plan" }], scripts: { plan } });
  const { site } = app;
  assert.ok(site);
  const { id: threadId, groupId } = json<{ id: string; groupId: string }>(
    await app.post("/api/threads", { text: "Plan kiosk wallets" }),
  );
  await app.app.settled();
  const entry = json<ThreadView>(await app.get(`/api/threads/${threadId}`)).entries.find(
    (e) => e.kind === "change-set",
  );
  assert.ok(entry?.kind === "change-set", "the run captured a change set");
  const approve = async (id: string) => {
    const { hash } = json<DiffView>(await app.post(`/api/change-sets/${id}/diff`));
    app.advance(1000);
    return json<Acted>(await app.post(`/api/change-sets/${id}/approve`, { hash }));
  };
  const members = async () =>
    json<GroupView>(await app.get(`/api/groups/${groupId}`)).members.map((m) => [
      m.ref.key,
      m.row?.title ?? null,
    ]);
  const epicCluster = (key: string) =>
    app.app.window("epic").clusters.find((c) => c.row.anchor?.key === key);

  // Jira's search won't find what this change set creates, or stop finding
  // what its revert deletes, until the test says so.
  site.searchLags();
  assert.equal((await approve(entry.changeSetId)).changeSet.status, "applied");
  const created = await members();
  assert.deepEqual(created, [
    ["SYN-900", "Kiosk wallets"],
    ["SYN-901", "Tap to pay"],
  ]);
  assert.equal(site.issue("SYN-900")?.issueType, "Epic");
  const cluster = epicCluster("SYN-900");
  assert.deepEqual(
    [cluster?.row.label, cluster?.list.map((row) => [row.key, row.title])],
    ["Kiosk wallets", [["SYN-901", "Tap to pay"]]],
  );

  const { revert } = json<Acted>(
    await app.post(`/api/change-sets/${entry.changeSetId}/revert`, {}),
  );
  assert.ok(revert);
  assert.equal((await approve(revert)).changeSet.status, "applied");
  assert.equal(site.issue("SYN-900"), null);
  assert.equal(site.issue("SYN-901"), null);
  // Still members, as a group changes only when the user changes it; gone
  // from the index, so neither shows as if it were there.
  assert.deepEqual(await members(), [
    ["SYN-900", null],
    ["SYN-901", null],
  ]);
  assert.equal(epicCluster("SYN-900"), undefined);
  assert.ok(
    app.app.window("epic").clusters.every((c) => c.list.every((row) => row.key !== "SYN-901")),
  );
});
