import assert from "node:assert/strict";
import { test } from "node:test";
import { type Instant, instant, type Run, type Ulid, ulid } from "@oriel/core";
import { groupStore } from "./groups.ts";
import { loadMigrations, migrate } from "./migrate.ts";
import { open } from "./open.ts";
import { runStore } from "./runs.ts";
import { telemetryStore } from "./telemetry.ts";
import { threadStore } from "./threads.ts";
import { ensureWorkspace, firstWorkspace } from "./workspaces.ts";

const t0 = instant(new Date(Date.UTC(2026, 9, 29, 9)));
const day = 24 * 60 * 60 * 1000;
const after = (ms: number): Instant => instant(new Date(Date.parse(t0) + ms));

// A workspace with a two-item group and a thread on it. IDs come from a
// counter, so each test's are its own and in order.
function fresh() {
  const db = open(":memory:");
  migrate(db, loadMigrations(), t0);
  let n = 0;
  const id = (): Ulid => ulid(++n, new Uint8Array(10));
  const workspaceId = id();
  ensureWorkspace(db, { id: workspaceId, name: "test" }, t0);
  const groups = groupStore(db);
  const groupId = id();
  groups.create(
    { id: groupId, workspaceId, name: "Checkout", origin: { kind: "picked" } },
    [
      { id: "jira:SYN-1", stableId: "10001" },
      { id: "jira:SYN-2", stableId: "10002" },
    ],
    t0,
  );
  const threads = threadStore(db);
  const threadId = id();
  threads.open({ id: threadId, workspaceId, groupId }, t0);
  return { db, id, workspaceId, groups, groupId, threads, threadId };
}

const item = (n: number) => ({ id: `jira:SYN-${n}` as const, stableId: String(10000 + n) });

test("the chat keeps what the user said and what the agent did, in order", () => {
  const { id, threads, threadId } = fresh();
  const first = threads.say(threadId, "What's left?", { marker: id(), message: id() }, after(1));
  assert.deepEqual(first, { move: null, seq: 1 });
  threads.append(threadId, { role: "agent", event: { kind: "text", text: "Two" } }, id(), after(2));
  threads.append(threadId, { role: "agent", event: { kind: "done" } }, id(), after(3));
  assert.deepEqual(threads.messages(threadId), [
    { seq: 1, at: after(1), role: "user", text: "What's left?" },
    { seq: 2, at: after(2), role: "agent", event: { kind: "text", text: "Two" } },
    { seq: 3, at: after(3), role: "agent", event: { kind: "done" } },
  ]);
  assert.deepEqual(
    threads.messages(threadId, 2).map((m) => m.seq),
    [3],
  );
  assert.throws(() => threads.append(id(), { role: "user", text: "x" }, id(), t0), /no thread/);
});

test("a working thread follows its group, with a marker in its chat", () => {
  const { id, groups, groupId, threads, threadId } = fresh();
  groups.add(groupId, [item(3)], { kind: "user" }, after(1));
  const moves = threads.follow(groupId, after(1), id);
  assert.deepEqual(moves, [{ threadId, from: 1, to: 2, seq: 1 }]);
  assert.equal(threads.get(threadId, after(2))?.regionVersion, 2);
  assert.deepEqual(threads.messages(threadId), [
    { seq: 1, at: after(1), role: "marker", from: 1, to: 2 },
  ]);
  // Nothing new: nothing moves.
  assert.deepEqual(threads.follow(groupId, after(3), id), []);
});

test("a settled thread keeps its version, and catches up when the user writes again", () => {
  const { id, groups, groupId, threads, threadId } = fresh();
  threads.markDone(threadId, after(1));
  groups.add(groupId, [item(3)], { kind: "user" }, after(2));
  groups.remove(groupId, [item(1)], { kind: "user" }, after(3));
  assert.deepEqual(threads.follow(groupId, after(3), id), []);
  assert.equal(threads.get(threadId, after(4))?.regionVersion, 1);
  const said = threads.say(threadId, "And now?", { marker: id(), message: id() }, after(5));
  assert.deepEqual(said, { move: { threadId, from: 1, to: 3, seq: 1 }, seq: 2 });
  const thread = threads.get(threadId, after(6));
  assert.deepEqual([thread?.state, thread?.regionVersion], ["working", 3]);
  assert.deepEqual(
    threads.messages(threadId).map((m) => m.role),
    ["marker", "user"],
  );
});

test("a dropped thread keeps its version too", () => {
  const { id, groups, groupId, threads, threadId } = fresh();
  groups.add(groupId, [item(3)], { kind: "user" }, after(8 * day));
  assert.deepEqual(threads.follow(groupId, after(8 * day), id), []);
  assert.equal(threads.get(threadId, after(8 * day))?.state, "dropped");
});

test("a marker alone isn't activity for the idle rule", () => {
  const { id, groups, groupId, threads, threadId } = fresh();
  groups.add(groupId, [item(3)], { kind: "user" }, after(6 * day));
  assert.equal(threads.follow(groupId, after(6 * day), id).length, 1);
  assert.equal(threads.get(threadId, after(7 * day))?.state, "dropped");
  const [summary] = threads.list(threads.get(threadId, t0)?.workspaceId ?? id(), after(7 * day));
  assert.equal(summary?.activityAt, t0);
});

test("threads list newest first, by workspace and by group, with their latest activity", () => {
  const { id, workspaceId, groups, groupId, threads, threadId } = fresh();
  const second = id();
  threads.open({ id: second, workspaceId, groupId }, after(10));
  const otherGroup = id();
  groups.create(
    { id: otherGroup, workspaceId, name: "Other", origin: { kind: "picked" } },
    [item(9)],
    after(11),
  );
  const third = id();
  threads.open({ id: third, workspaceId, groupId: otherGroup }, after(12));
  threads.say(threadId, "hi", { marker: id(), message: id() }, after(20));
  const listed = threads.list(workspaceId, after(30));
  assert.deepEqual(
    listed.map((s) => [s.thread.id, s.activityAt]),
    [
      [third, after(12)],
      [second, after(10)],
      [threadId, after(20)],
    ],
  );
  assert.deepEqual(
    threads.ofGroup(groupId, after(30)).map((s) => s.thread.id),
    [second, threadId],
  );
});

test("groups list newest first", () => {
  const { id, workspaceId, groups, groupId } = fresh();
  const later = id();
  groups.create(
    { id: later, workspaceId, name: "Later", origin: { kind: "picked" } },
    [],
    after(5),
  );
  assert.deepEqual(
    groups.list(workspaceId).map((g) => [g.id, g.name, g.version]),
    [
      [later, "Later", 1],
      [groupId, "Checkout", 1],
    ],
  );
  assert.deepEqual(groups.list(id()), []);
});

test("renaming a group takes no version", () => {
  const { id, groups, groupId } = fresh();
  groups.rename(groupId, "Checkout v2");
  assert.deepEqual([groups.get(groupId)?.name, groups.get(groupId)?.version], ["Checkout v2", 1]);
  assert.throws(() => groups.rename(id(), "x"), /no group/);
});

test("a run is recorded with its reads: arguments and payload hashes, never payloads", () => {
  const { db, id, workspaceId, threadId } = fresh();
  const run: Run = {
    id: id(),
    workspaceId,
    threadId,
    snapshot: 1,
    regionVersion: 1,
    systemPromptHash: "p",
    dtsHash: "d",
    model: "scripted",
    inputTokens: 0,
    outputTokens: 0,
    wallMs: 12.6,
    coldStartMs: null,
    outcome: "ok",
    startedAt: t0,
  };
  runStore(db).record(run, [
    {
      fn: "items.list",
      args: [],
      ms: 3,
      status: "answered",
      outsideRegion: false,
      payloadHash: "h1",
    },
    { fn: "search", args: ["x"], ms: 1, status: "failed", outsideRegion: null, payloadHash: null },
  ]);
  assert.deepEqual(
    db
      .prepare("select wall_ms, outcome, region_version from runs")
      .all()
      .map((r) => ({ ...r })),
    [{ wall_ms: 13, outcome: "ok", region_version: 1 }],
  );
  assert.deepEqual(
    db
      .prepare("select seq, fn, args, outside_region, status, payload_hash from run_reads")
      .all()
      .map((r) => ({ ...r })),
    [
      {
        seq: 1,
        fn: "items.list",
        args: "[]",
        outside_region: 0,
        status: "answered",
        payload_hash: "h1",
      },
      {
        seq: 2,
        fn: "search",
        args: '["x"]',
        outside_region: null,
        status: "failed",
        payload_hash: null,
      },
    ],
  );
  // A second record of the same run fails as a whole.
  assert.throws(() => runStore(db).record(run, []));
  assert.equal(db.prepare("select count(*) as n from run_reads").get()?.n, 2);
});

test("telemetry keeps each raw event, oldest first", () => {
  const { db, id, workspaceId, groupId, threadId } = fresh();
  const telemetry = telemetryStore(db);
  telemetry.record(
    { name: "thread.opened", at: after(2), workspaceId, threadId, groupId, regionSize: 2 },
    id(),
  );
  telemetry.record(
    { name: "group.created", at: after(1), workspaceId, groupId, origin: "picked", size: 2 },
    id(),
  );
  assert.deepEqual(telemetry.list(workspaceId), [
    { name: "group.created", at: after(1), data: { groupId, origin: "picked", size: 2 } },
    { name: "thread.opened", at: after(2), data: { threadId, groupId, regionSize: 2 } },
  ]);
});

test("the inbox and a thread's change sets are read through indexes", () => {
  const { db } = fresh();
  const plan = (sql: string) =>
    db
      .prepare(`explain query plan ${sql}`)
      .all()
      .map((row) => String(row.detail))
      .join("\n");
  assert.match(
    plan("select id from threads where workspace_id = 'w' order by created_at desc, id desc"),
    /threads_by_workspace/,
  );
  assert.match(
    plan("select id from change_sets where thread_id = 't' order by created_at, rowid"),
    /change_sets_by_thread/,
  );
  assert.match(
    plan("select id from threads where group_id = 'g' order by created_at desc, id desc"),
    /threads_by_group/,
  );
});

test("the first workspace is the oldest, or none", () => {
  const db = open(":memory:");
  migrate(db, loadMigrations(), t0);
  assert.equal(firstWorkspace(db), null);
  const [a, b] = [ulid(2, new Uint8Array(10)), ulid(1, new Uint8Array(10))];
  ensureWorkspace(db, { id: a, name: "a" }, t0);
  ensureWorkspace(db, { id: b, name: "b" }, after(1));
  assert.equal(firstWorkspace(db), a);
});
