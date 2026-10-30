import assert from "node:assert/strict";
import { test } from "node:test";
import { type GroupMember, type Instant, instant, type Ulid, ulid } from "@oriel/core";
import { groupStore } from "./groups.ts";
import { loadMigrations, migrate } from "./migrate.ts";
import { open } from "./open.ts";
import { ensureWorkspace } from "./workspaces.ts";

const t0 = instant(new Date(Date.UTC(2026, 9, 29, 9)));
const later = (minutes: number): Instant => instant(new Date(Date.parse(t0) + minutes * 60_000));

const m = (key: string, stableId: string): GroupMember => ({ id: `jira:${key}`, stableId });
const syn1 = m("SYN-1", "10001");
const syn2 = m("SYN-2", "10002");
const syn3 = m("SYN-3", "10003");
const user = { kind: "user" } as const;

function fresh() {
  const db = open(":memory:");
  migrate(db, loadMigrations(), t0);
  const workspaceId = ulid(0, new Uint8Array(10));
  ensureWorkspace(db, { id: workspaceId, name: "test" }, t0);
  const groups = groupStore(db);
  const create = (members: GroupMember[], id: Ulid = ulid(1, new Uint8Array(10))) =>
    groups.create({ id, workspaceId, name: "Checkout", origin: { kind: "picked" } }, members, t0);
  const ids = (groupId: Ulid, version: number) =>
    groups.region(groupId, version)?.items.map((item) => item.id) ?? null;
  return { db, workspaceId, groups, create, ids };
}

test("a new group is version 1, holding what it was made with", () => {
  const { groups, create, ids, workspaceId } = fresh();
  const group = create([syn1, syn2, syn1]);
  assert.equal(group.version, 1);
  assert.deepEqual(groups.get(group.id), group);
  assert.deepEqual(groups.region(group.id, 1), {
    groupId: group.id,
    version: 1,
    workspaceId,
    items: [syn1, syn2],
    origin: { kind: "picked" },
  });
  assert.equal(ids(group.id, 0), null);
  assert.equal(ids(group.id, 2), null);
  assert.equal(ids(group.id, 1.5), null);
  assert.equal(groups.region(ulid(2, new Uint8Array(10)), 1), null);
});

test("each change takes the next version, and every version keeps its own membership", () => {
  const { groups, create, ids } = fresh();
  const group = create([syn1]);
  const added = groups.add(group.id, [syn2, syn3], user, later(1));
  assert.deepEqual(added, {
    groupId: group.id,
    version: 2,
    at: later(1),
    added: [syn2, syn3],
    removed: [],
    cause: user,
  });
  const removed = groups.remove(group.id, [syn1], user, later(2));
  assert.deepEqual([removed?.version, removed?.added, removed?.removed], [3, [], [syn1]]);
  assert.equal(groups.get(group.id)?.version, 3);
  assert.deepEqual(ids(group.id, 1), ["jira:SYN-1"]);
  assert.deepEqual(ids(group.id, 2), ["jira:SYN-1", "jira:SYN-2", "jira:SYN-3"]);
  assert.deepEqual(ids(group.id, 3), ["jira:SYN-2", "jira:SYN-3"]);
  assert.deepEqual(
    groups.changes(group.id, 1).map((c) => [c.version, c.added.length, c.removed.length]),
    [
      [2, 2, 0],
      [3, 0, 1],
    ],
  );
  assert.deepEqual(groups.changes(group.id, 3), []);
});

test("a change that changes nothing takes no version", () => {
  const { groups, create } = fresh();
  const group = create([syn1]);
  assert.equal(groups.add(group.id, [syn1], user, later(1)), null);
  assert.equal(groups.remove(group.id, [syn2], user, later(1)), null);
  assert.equal(groups.add(group.id, [], user, later(1)), null);
  assert.equal(groups.get(group.id)?.version, 1);
  // Only what is new counts.
  assert.deepEqual(groups.add(group.id, [syn1, syn2], user, later(2))?.added, [syn2]);
});

test("an item removed and added again is out of the versions between", () => {
  const { groups, create, ids } = fresh();
  const group = create([syn1, syn2]);
  groups.remove(group.id, [syn2], user, later(1));
  const back = groups.add(group.id, [syn2], user, later(2));
  assert.deepEqual([back?.version, back?.added], [3, [syn2]]);
  assert.deepEqual(ids(group.id, 1), ["jira:SYN-1", "jira:SYN-2"]);
  assert.deepEqual(ids(group.id, 2), ["jira:SYN-1"]);
  assert.deepEqual(ids(group.id, 3), ["jira:SYN-1", "jira:SYN-2"]);
  // And out again: each stint is its own.
  groups.remove(group.id, [syn2], user, later(3));
  assert.deepEqual(ids(group.id, 3), ["jira:SYN-1", "jira:SYN-2"]);
  assert.deepEqual(ids(group.id, 4), ["jira:SYN-1"]);
  assert.deepEqual(
    groups.changes(group.id, 0).map((c) => [c.version, c.added, c.removed]),
    [
      [1, [syn1, syn2], []],
      [2, [], [syn2]],
      [3, [syn2], []],
      [4, [], [syn2]],
    ],
  );
});

test("members are matched by stable ID, so a moved item is the same member", () => {
  const { groups, create, ids } = fresh();
  const group = create([syn1, m("SYN-13", "10013")]);
  // SYN-13 moved to another project and is FER-7 now.
  const moved = m("FER-7", "10013");
  assert.equal(groups.add(group.id, [moved], user, later(1)), null);
  // The region keeps the handle the member was added with; reads follow moves.
  assert.deepEqual(ids(group.id, 1), ["jira:SYN-1", "jira:SYN-13"]);
  const removed = groups.remove(group.id, [moved], user, later(2));
  assert.deepEqual(removed?.removed, [m("SYN-13", "10013")]);
  assert.deepEqual(ids(group.id, 2), ["jira:SYN-1"]);
  // A handle reused by another item is another member.
  const reused = groups.add(group.id, [m("SYN-1", "20001")], user, later(3));
  assert.deepEqual(reused?.added, [m("SYN-1", "20001")]);
  assert.deepEqual(groups.region(group.id, 3)?.items, [syn1, m("SYN-1", "20001")]);
});

test("the same stable ID from two sources is two members", () => {
  const { groups, create } = fresh();
  const group = create([syn1]);
  const file: GroupMember = { id: "folder:0123456789abcdef", stableId: "10001" };
  assert.deepEqual(groups.add(group.id, [file], user, later(1))?.added, [file]);
  assert.equal(groups.region(group.id, 2)?.items.length, 2);
});

test("a change set's item joining the group says which change set it came from", () => {
  const { groups, create } = fresh();
  const group = create([syn1]);
  const changeSetId = ulid(5, new Uint8Array(10));
  const joined = groups.add(
    group.id,
    [m("SYN-900", "20900")],
    { kind: "change-set", changeSetId },
    later(1),
  );
  assert.deepEqual(joined?.cause, { kind: "change-set", changeSetId });
  assert.deepEqual(groups.changes(group.id, 1)[0]?.cause, { kind: "change-set", changeSetId });
});

test("a group made from a cluster keeps its origin", () => {
  const { groups, workspaceId } = fresh();
  const origin = {
    kind: "cluster",
    grouping: "epic",
    cluster: "10001",
    anchor: "jira:SYN-1",
  } as const;
  const group = groups.create(
    { id: ulid(3, new Uint8Array(10)), workspaceId, name: "Checkout v2", origin },
    [syn1, syn2],
    t0,
  );
  assert.deepEqual(group.origin, origin);
  assert.deepEqual(groups.region(group.id, 1)?.origin, origin);
});

test("malformed members and unknown groups are refused, and nothing is recorded", () => {
  const { groups, create } = fresh();
  const group = create([syn1]);
  assert.throws(
    () =>
      groups.add(group.id, [{ id: "jira:syn-2" as GroupMember["id"], stableId: "1" }], user, t0),
    /not an item ID/,
  );
  assert.throws(() => groups.add(group.id, [m("SYN-2", "")], user, t0), /no stable ID/);
  assert.throws(() => groups.add(ulid(9, new Uint8Array(10)), [syn2], user, t0), /no group/);
  assert.throws(
    () => groups.add(group.id, [syn2], { kind: "robot" } as never, t0),
    /corrupt cause/,
  );
  assert.equal(groups.get(group.id)?.version, 1);
  assert.throws(() => create([syn1], group.id), /UNIQUE|PRIMARY KEY/);
});
