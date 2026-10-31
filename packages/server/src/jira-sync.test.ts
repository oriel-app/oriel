// Syncing Jira on demand from the window, against a live site: what was made
// or deleted there since the last sync shows, without a restart.
import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  ChangeSetView,
  DiffView,
  GroupSummary,
  GroupView,
  JiraView,
  ThreadView,
} from "@oriel/web/view";
import { json, type Script, testApp } from "./testing.ts";

type Synced = { jira: JiraView };

const keys = (app: Awaited<ReturnType<typeof testApp>>) =>
  new Set(
    app.app
      .window("epic")
      .clusters.flatMap((c) => [c.row.anchor?.key, ...c.list.map((r) => r.key)]),
  );

test("Sync shows the epics and stories made in Jira, and what was deleted there goes", async (t) => {
  const app = await testApp(t, { live: true });
  const { site } = app;
  assert.ok(site);
  const created = await app.post("/api/groups", {
    kind: "picked",
    name: "Declines",
    items: ["jira:SYN-10", "jira:SYN-21"],
  });
  const { id: groupId, version } = json<GroupSummary>(created);
  const before = json<{ jira: JiraView }>(await app.get("/api/jira")).jira.connected;
  assert.ok(before);

  // A teammate works in Jira directly.
  const epic = site.add({ issueType: "Epic", summary: "Kiosk wallets" });
  const story = site.add({ issueType: "Story", summary: "Tap to pay", epic });
  site.remove("SYN-21");
  assert.ok(!keys(app).has(epic), "nothing shows before a sync");

  app.advance(60_000);
  const reply = await app.post("/api/jira/sync");
  assert.equal(reply.status, 200);
  const after = json<Synced>(reply).jira.connected;
  assert.deepEqual(
    [after?.project, after?.items, after?.syncedAt],
    ["SYN", before.items + 1, "2026-10-29T09:01:00.000Z"],
  );
  const cluster = app.app.window("epic").clusters.find((c) => c.row.anchor?.key === epic);
  assert.deepEqual(
    [cluster?.row.label, cluster?.list.map((row) => [row.key, row.title])],
    ["Kiosk wallets", [[story, "Tap to pay"]]],
  );
  assert.ok(!keys(app).has("SYN-21"), "the deleted story is gone from the window");

  // The group keeps it, at the same version: a group changes only when the
  // user changes it, so its region stays the one its threads work in.
  const group = json<GroupView>(await app.get(`/api/groups/${groupId}`));
  assert.equal(group.group.version, version);
  assert.deepEqual(
    group.members.map((m) => [m.ref.key, m.row?.title ?? null]),
    [
      ["SYN-10", "Remove the legacy web-view checkout"],
      ["SYN-21", null],
    ],
  );
  const syncs = app.app.telemetry().filter((e) => e.name === "source.synced");
  assert.deepEqual(
    syncs.map((e) => e.data),
    [{ source: "jira", ok: true }],
  );
});

test("a Sync that fails says why in plain words, and the window keeps what it had", async (t) => {
  const app = await testApp(t, { live: true });
  const { site } = app;
  assert.ok(site);
  const shown = keys(app);
  site.remove("SYN-21");

  site.outage("offline");
  const offline = await app.post("/api/jira/sync");
  assert.equal(offline.status, 502);
  assert.match(json<{ error: string }>(offline).error, /couldn't reach Jira just now/);
  site.outage("signed-out");
  const refused = await app.post("/api/jira/sync");
  assert.equal(refused.status, 502);
  assert.match(json<{ error: string }>(refused).error, /Jira turned Oriel away/);
  assert.doesNotMatch(json<{ error: string }>(refused).error, /401|token/);
  assert.deepEqual(keys(app), shown);

  site.outage(null);
  assert.equal((await app.post("/api/jira/sync")).status, 200);
  assert.ok(!keys(app).has("SYN-21"));
  assert.deepEqual(
    app.app
      .telemetry()
      .filter((e) => e.name === "source.synced")
      .map((e) => e.data.ok),
    [false, false, true],
  );
});

test("Syncs asked for while one runs wait for it, and run as one sweep after it", async (t) => {
  const app = await testApp(t, { live: true });
  const { site } = app;
  assert.ok(site);
  const sweeps = () =>
    app.logged.filter((l) => l.message === "sync: finished" && l.fields.full === true).length;
  const startup = sweeps();
  const search = site.hold("search");
  const first = app.post("/api/jira/sync");
  await search.reached;
  const later = [app.post("/api/jira/sync"), app.post("/api/jira/sync")];
  search.release();
  const replies = await Promise.all([first, ...later]);
  assert.deepEqual(
    replies.map((r) => r.status),
    [200, 200, 200],
  );
  // The first, then one for both that came while it ran.
  assert.equal(sweeps() - startup, 2);
});

test("a Sync that fails partway marks nothing gone, and the next one does", async (t) => {
  const app = await testApp(t, { live: true });
  const { site } = app;
  assert.ok(site);
  site.remove("SYN-21");
  // The first page of the listing arrives; then the network goes.
  const search = site.hold("search");
  const reply = app.post("/api/jira/sync");
  await search.reached;
  site.outage("offline");
  search.release();
  assert.match(json<{ error: string }>(await reply).error, /couldn't reach Jira just now/);
  assert.ok(keys(app).has("SYN-21"), "a sweep that didn't finish can't say what's gone");
  site.outage(null);
  assert.equal((await app.post("/api/jira/sync")).status, 200);
  assert.ok(!keys(app).has("SYN-21"));
});

test("an unexpected answer from Jira isn't called an outage", async (t) => {
  const app = await testApp(t, { live: true });
  const { site } = app;
  assert.ok(site);
  site.remove("SYN-21");
  const shown = keys(app);
  site.outage("unexpected");
  const reply = await app.post("/api/jira/sync");
  assert.equal(reply.status, 502);
  assert.match(json<{ error: string }>(reply).error, /in a way Oriel didn't expect/);
  assert.deepEqual(keys(app), shown);
});

const plan: Script = async () => ({
  value: null,
  writes: [["jira.createEpic", [{ summary: "Kiosk wallets" }], "new:1"]],
});

test("what a revert deleted stays gone while Jira's search lags, however long", async (t) => {
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
  const drop = await app.post(`/api/groups/${groupId}/drop`, {
    links: ["https://oriel.atlassian.net/browse/SYN-999"],
    files: [],
  });
  assert.equal(drop.status, 200);
  assert.ok(!keys(app).has("SYN-900"), "an incremental sync doesn't bring it back");
  assert.equal((await app.post("/api/jira/sync")).status, 200);
  assert.ok(!keys(app).has("SYN-900"), "nor does a full sweep");
  const members = json<GroupView>(await app.get(`/api/groups/${groupId}`)).members;
  assert.deepEqual(
    members.map((m) => [m.ref.key, m.row]),
    [["SYN-900", null]],
  );
});
