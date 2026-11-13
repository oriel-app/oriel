import assert from "node:assert/strict";
import { test } from "node:test";
import { type WorkstreamMember, type Instant, instant, type Ulid, ulid } from "@oriel/core";
import { workstreamStore } from "./workstreams.ts";
import { loadMigrations, migrate } from "./migrate.ts";
import { open } from "./open.ts";
import { ensureWorkspace } from "./workspaces.ts";

const t0 = instant(new Date(Date.UTC(2026, 9, 29, 9)));
const later = (minutes: number): Instant => instant(new Date(Date.parse(t0) + minutes * 60_000));

const m = (key: string, stableId: string): WorkstreamMember => ({ id: `jira:${key}`, stableId });
const syn1 = m("SYN-1", "10001");
const syn2 = m("SYN-2", "10002");
const syn3 = m("SYN-3", "10003");
const user = { kind: "user" } as const;

function fresh() {
  const db = open(":memory:");
  migrate(db, loadMigrations(), t0);
  const workspaceId = ulid(0, new Uint8Array(10));
  ensureWorkspace(db, { id: workspaceId, name: "test" }, t0);
  const workstreams = workstreamStore(db);
  const create = (members: WorkstreamMember[], id: Ulid = ulid(1, new Uint8Array(10))) =>
    workstreams.create(
      { id, workspaceId, name: "Checkout", origin: { kind: "picked" } },
      members,
      t0,
    );
  const ids = (workstreamId: Ulid, version: number) =>
    workstreams.region(workstreamId, version)?.items.map((item) => item.id) ?? null;
  return { db, workspaceId, workstreams, create, ids };
}

test("an item removed and added again is out of the versions between", () => {
  const { workstreams, create, ids } = fresh();
  const workstream = create([syn1, syn2]);
  workstreams.remove(workstream.id, [syn2], user, later(1));
  const back = workstreams.add(workstream.id, [syn2], user, later(2));
  assert.deepEqual([back?.version, back?.added], [3, [syn2]]);
  assert.deepEqual(ids(workstream.id, 1), ["jira:SYN-1", "jira:SYN-2"]);
  assert.deepEqual(ids(workstream.id, 2), ["jira:SYN-1"]);
  assert.deepEqual(ids(workstream.id, 3), ["jira:SYN-1", "jira:SYN-2"]);
  workstreams.remove(workstream.id, [syn2], user, later(3));
  assert.deepEqual(ids(workstream.id, 3), ["jira:SYN-1", "jira:SYN-2"]);
  assert.deepEqual(ids(workstream.id, 4), ["jira:SYN-1"]);
  assert.deepEqual(
    workstreams.changes(workstream.id, 0).map((c) => [c.version, c.added, c.removed]),
    [
      [1, [syn1, syn2], []],
      [2, [], [syn2]],
      [3, [syn2], []],
      [4, [], [syn2]],
    ],
  );
});

test("members are matched by stable ID, so a moved item is the same member", () => {
  const { workstreams, create, ids } = fresh();
  const workstream = create([syn1, m("SYN-13", "10013")]);
  const moved = m("FER-7", "10013");
  assert.equal(workstreams.add(workstream.id, [moved], user, later(1)), null);
  assert.deepEqual(ids(workstream.id, 1), ["jira:SYN-1", "jira:SYN-13"]);
  const removed = workstreams.remove(workstream.id, [moved], user, later(2));
  assert.deepEqual(removed?.removed, [m("SYN-13", "10013")]);
  assert.deepEqual(ids(workstream.id, 2), ["jira:SYN-1"]);
  const reused = workstreams.add(workstream.id, [m("SYN-1", "20001")], user, later(3));
  assert.deepEqual(reused?.added, [m("SYN-1", "20001")]);
  assert.deepEqual(workstreams.region(workstream.id, 3)?.items, [syn1, m("SYN-1", "20001")]);
});

test("the same stable ID from two sources is two members", () => {
  const { workstreams, create } = fresh();
  const workstream = create([syn1]);
  const file: WorkstreamMember = { id: "folder:0123456789abcdef", stableId: "10001" };
  assert.deepEqual(workstreams.add(workstream.id, [file], user, later(1))?.added, [file]);
  assert.equal(workstreams.region(workstream.id, 2)?.items.length, 2);
});

test("malformed members and unknown workstreams are refused, and nothing is recorded", () => {
  const { workstreams, create } = fresh();
  const workstream = create([syn1]);
  assert.throws(() =>
    workstreams.add(
      workstream.id,
      [{ id: "jira:SYN 2" as WorkstreamMember["id"], stableId: "1" }],
      user,
      t0,
    ),
  );
  assert.throws(() => workstreams.add(workstream.id, [m("SYN-2", "")], user, t0));
  assert.throws(() => workstreams.add(ulid(9, new Uint8Array(10)), [syn2], user, t0));
  assert.throws(() => workstreams.add(workstream.id, [syn2], { kind: "robot" } as never, t0));
  assert.equal(workstreams.get(workstream.id)?.version, 1);
  assert.throws(() => create([syn1], workstream.id), /UNIQUE|PRIMARY KEY/);
});

test("a workstream no thread uses is deleted with its log; one a thread uses stays", () => {
  const { db, workspaceId, workstreams, create } = fresh();
  const free = ulid(5, new Uint8Array(10));
  create([syn1, syn2], free);
  workstreams.rename(free, "Mine");
  workstreams.remove(free, [syn2], user, later(1));
  assert.equal(workstreams.delete(free), true);
  assert.equal(workstreams.get(free), null);
  for (const table of ["workstream_members", "workstream_changes", "user_named_workstreams"])
    assert.equal(
      db.prepare(`select count(*) as n from ${table} where workstream_id = ?`).get(free)?.["n"],
      0,
      table,
    );
  const used = ulid(6, new Uint8Array(10));
  create([syn3], used);
  db.prepare(
    "insert into threads (id, workspace_id, workstream_id, region_version, created_at) values (?, ?, ?, 1, ?)",
  ).run(ulid(7, new Uint8Array(10)), workspaceId, used, t0);
  assert.equal(workstreams.delete(used), false);
  assert.ok(workstreams.get(used));
  assert.throws(() => workstreams.delete(free));
});
