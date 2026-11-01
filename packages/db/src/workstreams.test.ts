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

test("a new workstream is version 1, holding what it was made with", () => {
  const { workstreams, create, ids, workspaceId } = fresh();
  const workstream = create([syn1, syn2, syn1]);
  assert.equal(workstream.version, 1);
  assert.deepEqual(workstreams.get(workstream.id), workstream);
  assert.deepEqual(workstreams.region(workstream.id, 1), {
    workstreamId: workstream.id,
    version: 1,
    workspaceId,
    items: [syn1, syn2],
    origin: { kind: "picked" },
  });
  assert.equal(ids(workstream.id, 0), null);
  assert.equal(ids(workstream.id, 2), null);
  assert.equal(ids(workstream.id, 1.5), null);
  assert.equal(workstreams.region(ulid(2, new Uint8Array(10)), 1), null);
});

test("each change takes the next version, and every version keeps its own membership", () => {
  const { workstreams, create, ids } = fresh();
  const workstream = create([syn1]);
  const added = workstreams.add(workstream.id, [syn2, syn3], user, later(1));
  assert.deepEqual(added, {
    workstreamId: workstream.id,
    version: 2,
    at: later(1),
    added: [syn2, syn3],
    removed: [],
    cause: user,
  });
  const removed = workstreams.remove(workstream.id, [syn1], user, later(2));
  assert.deepEqual([removed?.version, removed?.added, removed?.removed], [3, [], [syn1]]);
  assert.equal(workstreams.get(workstream.id)?.version, 3);
  assert.deepEqual(ids(workstream.id, 1), ["jira:SYN-1"]);
  assert.deepEqual(ids(workstream.id, 2), ["jira:SYN-1", "jira:SYN-2", "jira:SYN-3"]);
  assert.deepEqual(ids(workstream.id, 3), ["jira:SYN-2", "jira:SYN-3"]);
  assert.deepEqual(
    workstreams.changes(workstream.id, 1).map((c) => [c.version, c.added.length, c.removed.length]),
    [
      [2, 2, 0],
      [3, 0, 1],
    ],
  );
  assert.deepEqual(workstreams.changes(workstream.id, 3), []);
});

test("a change that changes nothing takes no version", () => {
  const { workstreams, create } = fresh();
  const workstream = create([syn1]);
  assert.equal(workstreams.add(workstream.id, [syn1], user, later(1)), null);
  assert.equal(workstreams.remove(workstream.id, [syn2], user, later(1)), null);
  assert.equal(workstreams.add(workstream.id, [], user, later(1)), null);
  assert.equal(workstreams.get(workstream.id)?.version, 1);
  // Only what is new counts.
  assert.deepEqual(workstreams.add(workstream.id, [syn1, syn2], user, later(2))?.added, [syn2]);
});

test("an item removed and added again is out of the versions between", () => {
  const { workstreams, create, ids } = fresh();
  const workstream = create([syn1, syn2]);
  workstreams.remove(workstream.id, [syn2], user, later(1));
  const back = workstreams.add(workstream.id, [syn2], user, later(2));
  assert.deepEqual([back?.version, back?.added], [3, [syn2]]);
  assert.deepEqual(ids(workstream.id, 1), ["jira:SYN-1", "jira:SYN-2"]);
  assert.deepEqual(ids(workstream.id, 2), ["jira:SYN-1"]);
  assert.deepEqual(ids(workstream.id, 3), ["jira:SYN-1", "jira:SYN-2"]);
  // And out again: each stint is its own.
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
  // SYN-13 moved to another project and is FER-7 now.
  const moved = m("FER-7", "10013");
  assert.equal(workstreams.add(workstream.id, [moved], user, later(1)), null);
  // The region keeps the handle the member was added with; reads follow moves.
  assert.deepEqual(ids(workstream.id, 1), ["jira:SYN-1", "jira:SYN-13"]);
  const removed = workstreams.remove(workstream.id, [moved], user, later(2));
  assert.deepEqual(removed?.removed, [m("SYN-13", "10013")]);
  assert.deepEqual(ids(workstream.id, 2), ["jira:SYN-1"]);
  // A handle reused by another item is another member.
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

test("a change set's item joining the workstream says which change set it came from", () => {
  const { workstreams, create } = fresh();
  const workstream = create([syn1]);
  const changeSetId = ulid(5, new Uint8Array(10));
  const joined = workstreams.add(
    workstream.id,
    [m("SYN-900", "20900")],
    { kind: "change-set", changeSetId },
    later(1),
  );
  assert.deepEqual(joined?.cause, { kind: "change-set", changeSetId });
  assert.deepEqual(workstreams.changes(workstream.id, 1)[0]?.cause, {
    kind: "change-set",
    changeSetId,
  });
});

test("a workstream made from a cluster keeps its origin", () => {
  const { workstreams, workspaceId } = fresh();
  const origin = {
    kind: "cluster",
    grouping: "epic",
    cluster: "10001",
    anchor: syn1,
  } as const;
  const workstream = workstreams.create(
    { id: ulid(3, new Uint8Array(10)), workspaceId, name: "Checkout v2", origin },
    [syn1, syn2],
    t0,
  );
  assert.deepEqual(workstream.origin, origin);
  assert.deepEqual(workstreams.region(workstream.id, 1)?.origin, origin);
});

test("a version without the item the workstream was made around has no anchor", () => {
  const { workstreams, workspaceId } = fresh();
  const origin = {
    kind: "cluster",
    grouping: "epic",
    cluster: "10001",
    anchor: syn1,
  } as const;
  const workstream = workstreams.create(
    { id: ulid(3, new Uint8Array(10)), workspaceId, name: "Checkout v2", origin },
    [syn1, syn2],
    t0,
  );
  workstreams.remove(workstream.id, [syn1], user, later(1));
  assert.deepEqual(workstreams.region(workstream.id, 2)?.origin, { ...origin, anchor: null });
  assert.deepEqual(workstreams.region(workstream.id, 2)?.items, [syn2]);
  // Earlier versions keep it, and putting it back brings it back.
  assert.deepEqual(workstreams.region(workstream.id, 1)?.origin, origin);
  workstreams.add(workstream.id, [syn1], user, later(2));
  assert.deepEqual(workstreams.region(workstream.id, 3)?.origin, origin);
  // The workstream itself still says where it came from.
  assert.deepEqual(workstreams.get(workstream.id)?.origin, origin);
});

test("an epic that moved projects and was added back is still the anchor, by stable ID", () => {
  const { workstreams, workspaceId } = fresh();
  const origin = { kind: "cluster", grouping: "epic", cluster: "10001", anchor: syn1 } as const;
  const workstream = workstreams.create(
    { id: ulid(3, new Uint8Array(10)), workspaceId, name: "Checkout v2", origin },
    [syn1, syn2],
    t0,
  );
  workstreams.remove(workstream.id, [syn1], user, later(1));
  // SYN-1 moved to another project and is OPS-1 now.
  const moved = m("OPS-1", "10001");
  workstreams.add(workstream.id, [moved], user, later(2));
  assert.deepEqual(workstreams.region(workstream.id, 3)?.origin, { ...origin, anchor: moved });
  // Another item with the anchor's old handle isn't the anchor.
  workstreams.remove(workstream.id, [moved], user, later(3));
  workstreams.add(workstream.id, [m("SYN-1", "20001")], user, later(4));
  assert.deepEqual(workstreams.region(workstream.id, 5)?.origin, { ...origin, anchor: null });
});

test("malformed members and unknown workstreams are refused, and nothing is recorded", () => {
  const { workstreams, create } = fresh();
  const workstream = create([syn1]);
  assert.throws(
    () =>
      workstreams.add(
        workstream.id,
        [{ id: "jira:syn-2" as WorkstreamMember["id"], stableId: "1" }],
        user,
        t0,
      ),
    /not an item ID/,
  );
  assert.throws(() => workstreams.add(workstream.id, [m("SYN-2", "")], user, t0), /no stable ID/);
  assert.throws(
    () => workstreams.add(ulid(9, new Uint8Array(10)), [syn2], user, t0),
    /no workstream/,
  );
  assert.throws(
    () => workstreams.add(workstream.id, [syn2], { kind: "robot" } as never, t0),
    /corrupt cause/,
  );
  assert.equal(workstreams.get(workstream.id)?.version, 1);
  assert.throws(() => create([syn1], workstream.id), /UNIQUE|PRIMARY KEY/);
});

test("Oriel names the workstreams it makes, and a name the user gives one is theirs", () => {
  const { workstreams, create } = fresh();
  const workstream = create([syn1]);
  assert.equal(workstream.namedBy, "oriel");
  assert.equal(workstreams.rename(workstream.id, "Checkout flow", "oriel"), true);
  assert.equal(workstreams.rename(workstream.id, "Checkout flow", "oriel"), false);
  assert.deepEqual(workstreams.get(workstream.id), { ...workstream, name: "Checkout flow" });
  assert.equal(workstreams.rename(workstream.id, "My checkout", "user"), true);
  assert.equal(workstreams.rename(workstream.id, "Checkout v3", "oriel"), false);
  assert.deepEqual(workstreams.get(workstream.id), {
    ...workstream,
    name: "My checkout",
    namedBy: "user",
  });
  // The user giving it the same name again is still theirs, and changes nothing.
  assert.equal(workstreams.rename(workstream.id, "My checkout", "user"), false);
  assert.equal(workstreams.rename(ulid(2, new Uint8Array(10)), "x", "oriel"), false);
});
