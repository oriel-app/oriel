// Who names a workstream, and when Oriel names one again: a workstream copied from an
// epic's cluster follows the epic's title, until the user names it.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type WorkstreamMember,
  type WorkstreamOrigin,
  type IndexRecord,
  instant,
  ulid,
} from "@oriel/core";
import { ensureWorkspace, workstreamStore, loadMigrations, migrate, open } from "@oriel/db";
import type { DiffView, WorkstreamView, ThreadView } from "@oriel/web/view";
import { followAnchors as follow } from "./names.ts";
import { json, type Script, t0, testApp } from "./testing.ts";

const now = instant(new Date(t0));
const id = (n: number) => ulid(n, new Uint8Array(10));
const record = (key: string, stableId: string, title: string): IndexRecord => ({
  id: `jira:${key}`,
  stableId,
  title,
  location: `https://oriel.atlassian.net/browse/${key}`,
  updatedAt: now,
  facets: { kind: "epic" },
  attrs: {},
});
const member = (key: string, stableId: string): WorkstreamMember => ({
  id: `jira:${key}`,
  stableId,
});

test("a workstream copied from an epic's cluster follows the epic's title while it holds the epic, until the user names it", async () => {
  const db = open(":memory:");
  migrate(db, loadMigrations(), now);
  const workspaceId = id(0);
  ensureWorkspace(db, { id: workspaceId, name: "test" }, now);
  const workstreams = workstreamStore(db);
  const epic = member("SYN-1", "10001");
  const story = member("SYN-10", "10010");
  const origin = { kind: "cluster", grouping: "epic", cluster: "10001", anchor: epic } as const;
  const make = (
    n: number,
    name: string,
    members = [epic, story],
    from: WorkstreamOrigin = origin,
  ) => workstreams.create({ id: id(n), workspaceId, name, origin: from }, members, now).id;
  const following = make(1, "Checkout");
  const named = make(2, "Checkout");
  workstreams.rename(named, "My checkout", "user");
  const without = make(3, "Checkout");
  workstreams.remove(without, [epic], { kind: "user" }, now);
  const picked = make(4, "Checkout", [epic], { kind: "picked" });
  const name = (workstream: typeof following) => workstreams.get(workstream)?.name;
  // The sync renames through the dispatcher; the store stands in for it here.
  const followAnchors = (records: IndexRecord[]) =>
    follow(workstreams, workspaceId, records, async (workstream, to) =>
      workstreams.rename(workstream, to, "oriel"),
    );

  await followAnchors([record("SYN-1", "10001", "Checkout v2")]);
  assert.deepEqual([following, named, without, picked].map(name), [
    "Checkout v2",
    "My checkout",
    "Checkout",
    "Checkout",
  ]);
  // Renaming takes no version: what the workstream holds is as it was.
  assert.equal(workstreams.get(following)?.version, 1);
  assert.deepEqual(workstreams.region(following, 1)?.items, [epic, story]);
  // An epic that moved projects is the same epic, by stable ID; one the
  // index no longer has leaves the name as it was.
  await followAnchors([record("OPS-1", "10001", "Checkout v3")]);
  assert.equal(name(following), "Checkout v3");
  await followAnchors([]);
  assert.equal(name(following), "Checkout v3");
  // Once the user names it, the epic's title no longer reaches it.
  workstreams.rename(following, "Wallets", "user");
  await followAnchors([record("SYN-1", "10001", "Checkout v4")]);
  assert.equal(name(following), "Wallets");
});

test("a cluster's workstream follows its epic renamed in Jira, with no new version, and a workstream the user named keeps its name", async (t) => {
  const rename: Script = async () => ({
    value: null,
    writes: [["jira.setSummary", ["jira:SYN-1", "Checkout v3: wallets"]]],
  });
  const app = await testApp(t, {
    live: true,
    plan: () => [{ run: "rename" }],
    scripts: { rename },
  });
  const checkout = { kind: "cluster", grouping: "epic", cluster: "10001" };
  const copy = async () =>
    json<{ id: string; name: string }>(await app.post("/api/workstreams", checkout));
  const following = await copy();
  const named = await copy();
  await app.post(`/api/workstreams/${named.id}/rename`, { name: "My checkout" });
  const { id: threadId } = json<{ id: string }>(
    await app.post(`/api/workstreams/${following.id}/threads`, { text: "Rename the epic" }),
  );
  await app.app.settled();
  const entry = json<ThreadView>(await app.get(`/api/threads/${threadId}`)).entries.find(
    (e) => e.kind === "change-set",
  );
  assert.ok(entry?.kind === "change-set", "the run captured a change set");
  const { hash } = json<DiffView>(await app.post(`/api/change-sets/${entry.changeSetId}/diff`));
  app.advance(1000);
  await app.post(`/api/change-sets/${entry.changeSetId}/approve`, { hash });

  const workstream = async (workstreamId: string) =>
    json<WorkstreamView>(await app.get(`/api/workstreams/${workstreamId}`)).workstream;
  assert.notEqual(following.name, "Checkout v3: wallets");
  assert.deepEqual(
    [(await workstream(following.id)).name, (await workstream(named.id)).name],
    ["Checkout v3: wallets", "My checkout"],
  );
  // What the workstream holds is as it was: no version, so no marker in its thread.
  assert.equal((await workstream(following.id)).version, 1);
  const entries = json<ThreadView>(await app.get(`/api/threads/${threadId}`)).entries;
  assert.equal(entries.filter((e) => e.kind === "marker").length, 0);
});

test('a workstream the user named "New workstream" keeps that name when a change set creates an epic in it', async (t) => {
  const plan: Script = async () => ({
    value: null,
    writes: [["jira.createEpic", [{ summary: "Kiosk wallets" }], "new:1"]],
  });
  const app = await testApp(t, { writes: true, plan: () => [{ run: "plan" }], scripts: { plan } });
  const { id: workstreamId } = json<{ id: string }>(
    await app.post("/api/workstreams", {
      kind: "picked",
      name: "Checkout",
      items: ["jira:SYN-10"],
    }),
  );
  await app.post(`/api/workstreams/${workstreamId}/rename`, { name: "New workstream" });
  await app.post(`/api/workstreams/${workstreamId}/remove`, { items: ["jira:SYN-10"] });
  const { id: threadId } = json<{ id: string }>(
    await app.post(`/api/workstreams/${workstreamId}/threads`, { text: "Plan kiosk wallets" }),
  );
  await app.app.settled();
  const view = json<ThreadView>(await app.get(`/api/threads/${threadId}`));
  const entry = view.entries.find((e) => e.kind === "change-set");
  assert.ok(entry?.kind === "change-set", "the run captured a change set");
  const { hash } = json<DiffView>(await app.post(`/api/change-sets/${entry.changeSetId}/diff`));
  app.advance(1000);
  await app.post(`/api/change-sets/${entry.changeSetId}/approve`, { hash });
  const after = json<WorkstreamView>(await app.get(`/api/workstreams/${workstreamId}`));
  assert.deepEqual([after.workstream.name, after.members.length], ["New workstream", 1]);
});

test('a thread\'s workstream the user named "New workstream" keeps that name when its epic is created', async (t) => {
  const plan: Script = async () => ({
    value: null,
    writes: [["jira.createEpic", [{ summary: "Kiosk wallets" }], "new:1"]],
  });
  const app = await testApp(t, { writes: true, plan: () => [{ run: "plan" }], scripts: { plan } });
  const { id: threadId, workstreamId } = json<{ id: string; workstreamId: string }>(
    await app.post("/api/threads", { text: "Plan kiosk wallets" }),
  );
  await app.post(`/api/workstreams/${workstreamId}/rename`, { name: "Wallets" });
  await app.post(`/api/workstreams/${workstreamId}/rename`, { name: "New workstream" });
  await app.app.settled();
  const view = json<ThreadView>(await app.get(`/api/threads/${threadId}`));
  const entry = view.entries.find((e) => e.kind === "change-set");
  assert.ok(entry?.kind === "change-set", "the run captured a change set");
  const { hash } = json<DiffView>(await app.post(`/api/change-sets/${entry.changeSetId}/diff`));
  app.advance(1000);
  await app.post(`/api/change-sets/${entry.changeSetId}/approve`, { hash });
  const after = json<WorkstreamView>(await app.get(`/api/workstreams/${workstreamId}`));
  assert.deepEqual([after.workstream.name, after.members.length], ["New workstream", 1]);
});

test("a sync renaming a workstream after its epic does it through the dispatcher, as the sync, and counts it", async (t) => {
  const rename: Script = async () => ({
    value: null,
    writes: [["jira.setSummary", ["jira:SYN-1", "Checkout v3: wallets"]]],
  });
  const app = await testApp(t, {
    live: true,
    plan: () => [{ run: "rename" }],
    scripts: { rename },
  });
  const { id: workstreamId } = json<{ id: string }>(
    await app.post("/api/workstreams", { kind: "cluster", grouping: "epic", cluster: "10001" }),
  );
  const { id: threadId } = json<{ id: string }>(
    await app.post(`/api/workstreams/${workstreamId}/threads`, { text: "Rename the epic" }),
  );
  await app.app.settled();
  const entry = json<ThreadView>(await app.get(`/api/threads/${threadId}`)).entries.find(
    (e) => e.kind === "change-set",
  );
  assert.ok(entry?.kind === "change-set", "the run captured a change set");
  const { hash } = json<DiffView>(await app.post(`/api/change-sets/${entry.changeSetId}/diff`));
  const renames = () =>
    app.app
      .telemetry()
      .filter((e) => e.name === "action.called" && e.data["action"] === "workstream.rename");
  assert.deepEqual(renames(), []);
  await app.post(`/api/change-sets/${entry.changeSetId}/approve`, { hash });
  assert.deepEqual(
    renames().map((e) => e.data),
    [{ action: "workstream.rename", by: { kind: "sync", source: "jira" } }],
  );
  // A sync that finds the name as it is renames nothing more.
  await app.post("/api/jira/sync");
  assert.equal(renames().length, 1);
});
