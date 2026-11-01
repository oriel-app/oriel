import assert from "node:assert/strict";
import { test } from "node:test";
import { type Instant, instant, type Run, type Ulid, ulid } from "@oriel/core";
import { folderStore } from "./folders.ts";
import { workstreamStore } from "./workstreams.ts";
import { loadMigrations, migrate } from "./migrate.ts";
import { open } from "./open.ts";
import { runStore } from "./runs.ts";
import { telemetryStore } from "./telemetry.ts";
import { threadStore } from "./threads.ts";
import { ensureWorkspace, firstWorkspace } from "./workspaces.ts";

const t0 = instant(new Date(Date.UTC(2026, 9, 29, 9)));
const day = 24 * 60 * 60 * 1000;
const after = (ms: number): Instant => instant(new Date(Date.parse(t0) + ms));

// A workspace with a two-item workstream and a thread on it. IDs come from a
// counter, so each test's are its own and in order.
function fresh() {
  const db = open(":memory:");
  migrate(db, loadMigrations(), t0);
  let n = 0;
  const id = (): Ulid => ulid(++n, new Uint8Array(10));
  const workspaceId = id();
  ensureWorkspace(db, { id: workspaceId, name: "test" }, t0);
  const workstreams = workstreamStore(db);
  const workstreamId = id();
  workstreams.create(
    { id: workstreamId, workspaceId, name: "Checkout", origin: { kind: "picked" } },
    [
      { id: "jira:SYN-1", stableId: "10001" },
      { id: "jira:SYN-2", stableId: "10002" },
    ],
    t0,
  );
  const threads = threadStore(db);
  const threadId = id();
  threads.open({ id: threadId, workspaceId, workstreamId }, t0);
  return { db, id, workspaceId, workstreams, workstreamId, threads, threadId };
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

test("a working thread follows its workstream, with a marker in its chat", () => {
  const { id, workstreams, workstreamId, threads, threadId } = fresh();
  workstreams.add(workstreamId, [item(3)], { kind: "user" }, after(1));
  const moves = threads.follow(workstreamId, after(1), id);
  assert.deepEqual(moves, [{ threadId, from: 1, to: 2, seq: 1 }]);
  assert.equal(threads.get(threadId, after(2))?.regionVersion, 2);
  assert.deepEqual(threads.messages(threadId), [
    { seq: 1, at: after(1), role: "marker", from: 1, to: 2 },
  ]);
  // Nothing new: nothing moves.
  assert.deepEqual(threads.follow(workstreamId, after(3), id), []);
});

test("a settled thread keeps its version, and catches up when the user writes again", () => {
  const { id, workstreams, workstreamId, threads, threadId } = fresh();
  threads.markDone(threadId, after(1));
  workstreams.add(workstreamId, [item(3)], { kind: "user" }, after(2));
  workstreams.remove(workstreamId, [item(1)], { kind: "user" }, after(3));
  assert.deepEqual(threads.follow(workstreamId, after(3), id), []);
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
  const { id, workstreams, workstreamId, threads, threadId } = fresh();
  workstreams.add(workstreamId, [item(3)], { kind: "user" }, after(8 * day));
  assert.deepEqual(threads.follow(workstreamId, after(8 * day), id), []);
  assert.equal(threads.get(threadId, after(8 * day))?.state, "dropped");
});

test("a marker alone isn't activity for the idle rule", () => {
  const { id, workstreams, workstreamId, threads, threadId } = fresh();
  workstreams.add(workstreamId, [item(3)], { kind: "user" }, after(6 * day));
  assert.equal(threads.follow(workstreamId, after(6 * day), id).length, 1);
  assert.equal(threads.get(threadId, after(7 * day))?.state, "dropped");
  const [summary] = threads.list(threads.get(threadId, t0)?.workspaceId ?? id(), after(7 * day));
  assert.equal(summary?.activityAt, t0);
});

test("threads list newest first, by workspace and by workstream, with their latest activity", () => {
  const { id, workspaceId, workstreams, workstreamId, threads, threadId } = fresh();
  const second = id();
  threads.open({ id: second, workspaceId, workstreamId }, after(10));
  const otherWorkstream = id();
  workstreams.create(
    { id: otherWorkstream, workspaceId, name: "Other", origin: { kind: "picked" } },
    [item(9)],
    after(11),
  );
  const third = id();
  threads.open({ id: third, workspaceId, workstreamId: otherWorkstream }, after(12));
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
    threads.ofWorkstream(workstreamId, after(30)).map((s) => s.thread.id),
    [second, threadId],
  );
});

test("workstreams list newest first", () => {
  const { id, workspaceId, workstreams, workstreamId } = fresh();
  const later = id();
  workstreams.create(
    { id: later, workspaceId, name: "Later", origin: { kind: "picked" } },
    [],
    after(5),
  );
  assert.deepEqual(
    workstreams.list(workspaceId).map((g) => [g.id, g.name, g.version]),
    [
      [later, "Later", 1],
      [workstreamId, "Checkout", 1],
    ],
  );
  assert.deepEqual(workstreams.list(id()), []);
});

test("renaming a workstream takes no version", () => {
  const { id, workstreams, workstreamId } = fresh();
  workstreams.rename(workstreamId, "Checkout v2");
  assert.deepEqual(
    [workstreams.get(workstreamId)?.name, workstreams.get(workstreamId)?.version],
    ["Checkout v2", 1],
  );
  assert.throws(() => workstreams.rename(id(), "x"), /no workstream/);
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
  const { db, id, workspaceId, workstreamId, threadId } = fresh();
  const telemetry = telemetryStore(db);
  telemetry.record(
    { name: "thread.opened", at: after(2), workspaceId, threadId, workstreamId, regionSize: 2 },
    id(),
  );
  telemetry.record(
    {
      name: "workstream.created",
      at: after(1),
      workspaceId,
      workstreamId,
      origin: "picked",
      size: 2,
    },
    id(),
  );
  assert.deepEqual(telemetry.list(workspaceId), [
    { name: "workstream.created", at: after(1), data: { workstreamId, origin: "picked", size: 2 } },
    { name: "thread.opened", at: after(2), data: { threadId, workstreamId, regionSize: 2 } },
  ]);
});

test("the threads list and a thread's change sets are read through indexes", () => {
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
    plan("select id from threads where workstream_id = 'g' order by created_at desc, id desc"),
    /threads_by_workstream/,
  );
});

test("a workspace connects one folder, and a new pick replaces it", () => {
  const { db, id, workspaceId } = fresh();
  const folders = folderStore(db);
  assert.equal(folders.get(workspaceId), null);
  const first = id();
  folders.connect(workspaceId, { id: first, path: "/Users/pm/notes" }, t0);
  assert.deepEqual(folders.get(workspaceId), {
    id: first,
    path: "/Users/pm/notes",
    connectedAt: t0,
  });
  const second = id();
  folders.connect(workspaceId, { id: second, path: "/Users/pm/plans" }, after(1));
  assert.deepEqual(folders.get(workspaceId), {
    id: second,
    path: "/Users/pm/plans",
    connectedAt: after(1),
  });
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
