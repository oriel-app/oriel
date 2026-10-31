// Who names a group, and when Oriel names one again: a group copied from an
// epic's cluster follows the epic's title, until the user names it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type GroupMember, type GroupOrigin, type IndexRecord, instant, ulid } from "@oriel/core";
import { ensureWorkspace, groupStore, loadMigrations, migrate, open } from "@oriel/db";
import type { DiffView, GroupView, ThreadView } from "@oriel/web/view";
import { followAnchors } from "./names.ts";
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
const member = (key: string, stableId: string): GroupMember => ({ id: `jira:${key}`, stableId });

test("a group copied from an epic's cluster follows the epic's title while it holds the epic, until the user names it", () => {
  const db = open(":memory:");
  migrate(db, loadMigrations(), now);
  const workspaceId = id(0);
  ensureWorkspace(db, { id: workspaceId, name: "test" }, now);
  const groups = groupStore(db);
  const epic = member("SYN-1", "10001");
  const story = member("SYN-10", "10010");
  const origin = { kind: "cluster", grouping: "epic", cluster: "10001", anchor: epic } as const;
  const make = (n: number, name: string, members = [epic, story], from: GroupOrigin = origin) =>
    groups.create({ id: id(n), workspaceId, name, origin: from }, members, now).id;
  const following = make(1, "Checkout");
  const named = make(2, "Checkout");
  groups.rename(named, "My checkout", "user");
  const without = make(3, "Checkout");
  groups.remove(without, [epic], { kind: "user" }, now);
  const picked = make(4, "Checkout", [epic], { kind: "picked" });
  const name = (group: typeof following) => groups.get(group)?.name;

  followAnchors(groups, workspaceId, [record("SYN-1", "10001", "Checkout v2")]);
  assert.deepEqual([following, named, without, picked].map(name), [
    "Checkout v2",
    "My checkout",
    "Checkout",
    "Checkout",
  ]);
  // Renaming takes no version: what the group holds is as it was.
  assert.equal(groups.get(following)?.version, 1);
  assert.deepEqual(groups.region(following, 1)?.items, [epic, story]);
  // An epic that moved projects is the same epic, by stable ID; one the
  // index no longer has leaves the name as it was.
  followAnchors(groups, workspaceId, [record("OPS-1", "10001", "Checkout v3")]);
  assert.equal(name(following), "Checkout v3");
  followAnchors(groups, workspaceId, []);
  assert.equal(name(following), "Checkout v3");
  // Once the user names it, the epic's title no longer reaches it.
  groups.rename(following, "Wallets", "user");
  followAnchors(groups, workspaceId, [record("SYN-1", "10001", "Checkout v4")]);
  assert.equal(name(following), "Wallets");
});

test("a cluster's group follows its epic renamed in Jira, with no new version, and a group the user named keeps its name", async (t) => {
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
    json<{ id: string; name: string }>(await app.post("/api/groups", checkout));
  const following = await copy();
  const named = await copy();
  await app.post(`/api/groups/${named.id}/rename`, { name: "My checkout" });
  const { id: threadId } = json<{ id: string }>(
    await app.post(`/api/groups/${following.id}/threads`, { text: "Rename the epic" }),
  );
  await app.app.settled();
  const entry = json<ThreadView>(await app.get(`/api/threads/${threadId}`)).entries.find(
    (e) => e.kind === "change-set",
  );
  assert.ok(entry?.kind === "change-set", "the run captured a change set");
  const { hash } = json<DiffView>(await app.post(`/api/change-sets/${entry.changeSetId}/diff`));
  app.advance(1000);
  await app.post(`/api/change-sets/${entry.changeSetId}/approve`, { hash });

  const group = async (groupId: string) =>
    json<GroupView>(await app.get(`/api/groups/${groupId}`)).group;
  assert.notEqual(following.name, "Checkout v3: wallets");
  assert.deepEqual(
    [(await group(following.id)).name, (await group(named.id)).name],
    ["Checkout v3: wallets", "My checkout"],
  );
  // What the group holds is as it was: no version, so no marker in its thread.
  assert.equal((await group(following.id)).version, 1);
  const entries = json<ThreadView>(await app.get(`/api/threads/${threadId}`)).entries;
  assert.equal(entries.filter((e) => e.kind === "marker").length, 0);
});

test('a group the user named "New group" keeps that name when a change set creates an epic in it', async (t) => {
  const plan: Script = async () => ({
    value: null,
    writes: [["jira.createEpic", [{ summary: "Kiosk wallets" }], "new:1"]],
  });
  const app = await testApp(t, { writes: true, plan: () => [{ run: "plan" }], scripts: { plan } });
  const { id: groupId } = json<{ id: string }>(
    await app.post("/api/groups", { kind: "picked", name: "Checkout", items: ["jira:SYN-10"] }),
  );
  await app.post(`/api/groups/${groupId}/rename`, { name: "New group" });
  await app.post(`/api/groups/${groupId}/remove`, { items: ["jira:SYN-10"] });
  const { id: threadId } = json<{ id: string }>(
    await app.post(`/api/groups/${groupId}/threads`, { text: "Plan kiosk wallets" }),
  );
  await app.app.settled();
  const view = json<ThreadView>(await app.get(`/api/threads/${threadId}`));
  const entry = view.entries.find((e) => e.kind === "change-set");
  assert.ok(entry?.kind === "change-set", "the run captured a change set");
  const { hash } = json<DiffView>(await app.post(`/api/change-sets/${entry.changeSetId}/diff`));
  app.advance(1000);
  await app.post(`/api/change-sets/${entry.changeSetId}/approve`, { hash });
  const after = json<GroupView>(await app.get(`/api/groups/${groupId}`));
  assert.deepEqual([after.group.name, after.members.length], ["New group", 1]);
});

test('a thread\'s group the user named "New group" keeps that name when its epic is created', async (t) => {
  const plan: Script = async () => ({
    value: null,
    writes: [["jira.createEpic", [{ summary: "Kiosk wallets" }], "new:1"]],
  });
  const app = await testApp(t, { writes: true, plan: () => [{ run: "plan" }], scripts: { plan } });
  const { id: threadId, groupId } = json<{ id: string; groupId: string }>(
    await app.post("/api/threads", { text: "Plan kiosk wallets" }),
  );
  await app.post(`/api/groups/${groupId}/rename`, { name: "Wallets" });
  await app.post(`/api/groups/${groupId}/rename`, { name: "New group" });
  await app.app.settled();
  const view = json<ThreadView>(await app.get(`/api/threads/${threadId}`));
  const entry = view.entries.find((e) => e.kind === "change-set");
  assert.ok(entry?.kind === "change-set", "the run captured a change set");
  const { hash } = json<DiffView>(await app.post(`/api/change-sets/${entry.changeSetId}/diff`));
  app.advance(1000);
  await app.post(`/api/change-sets/${entry.changeSetId}/approve`, { hash });
  const after = json<GroupView>(await app.get(`/api/groups/${groupId}`));
  assert.deepEqual([after.group.name, after.members.length], ["New group", 1]);
});
