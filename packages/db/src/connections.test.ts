import assert from "node:assert/strict";
import { test } from "node:test";
import { instant, type Ulid, ulid } from "@oriel/core";
import { connectionStore } from "./connections.ts";
import { loadMigrations, migrate } from "./migrate.ts";
import { open } from "./open.ts";
import { ensureWorkspace } from "./workspaces.ts";

const t0 = instant(new Date(Date.UTC(2026, 10, 3, 9)));
const later = (minutes: number) => instant(new Date(Date.parse(t0) + minutes * 60_000));

function fresh() {
  const db = open(":memory:");
  migrate(db, loadMigrations(), t0);
  let n = 0;
  const id = (): Ulid => ulid(++n, new Uint8Array(10));
  const workspaceId = id();
  ensureWorkspace(db, { id: workspaceId, name: "test" }, t0);
  return { db, id, workspaceId, connections: connectionStore(db) };
}

const acme = "https://acme.atlassian.net";

test("a connection is numbered within its kind, and its prefix follows", () => {
  const { id, workspaceId, connections } = fresh();
  const first = connections.connect(
    workspaceId,
    { id: id(), kind: "jira", identity: acme, options: { project: "SYN" } },
    t0,
  );
  const folder = connections.connect(
    workspaceId,
    { id: id(), kind: "folder", identity: "/Users/pm/notes", options: {} },
    t0,
  );
  const second = connections.connect(
    workspaceId,
    { id: id(), kind: "jira", identity: "https://globex.atlassian.net", options: {} },
    later(1),
  );
  assert.ok("connection" in first && "connection" in folder && "connection" in second);
  assert.deepEqual(
    [first, folder, second].map((made) => [made.connection.prefix, made.revived]),
    [
      ["jira", false],
      ["folder", false],
      ["jira.2", false],
    ],
  );
  assert.deepEqual(connections.get(workspaceId, first.connection.id), {
    id: first.connection.id,
    kind: "jira",
    number: 1,
    prefix: "jira",
    identity: acme,
    name: null,
    options: { project: "SYN" },
    every: null,
    connectedAt: t0,
    disconnectedAt: null,
  });
  assert.deepEqual(
    connections.live(workspaceId, "jira").map((c) => c.prefix),
    ["jira", "jira.2"],
  );
});

test("a second connection to the same thing is refused, with the one that has it", () => {
  const { id, workspaceId, connections } = fresh();
  const made = connections.connect(
    workspaceId,
    { id: id(), kind: "jira", identity: acme, options: { project: "SYN" } },
    t0,
  );
  assert.ok("connection" in made);
  const again = connections.connect(
    workspaceId,
    { id: id(), kind: "jira", identity: acme, options: { project: "ACME" } },
    later(1),
  );
  assert.deepEqual(again, { taken: made.connection });
  assert.deepEqual(connections.planned(workspaceId, "jira", acme), { live: made.connection });
  // The same text is another thing to another connector.
  const folder = connections.connect(
    workspaceId,
    { id: id(), kind: "folder", identity: acme, options: {} },
    later(1),
  );
  assert.ok("connection" in folder);
});

test("a disconnected connection is a tombstone, which connecting the same thing revives", () => {
  const { id, workspaceId, connections } = fresh();
  const notes = connections.connect(
    workspaceId,
    { id: id(), kind: "folder", identity: "/Users/pm/notes", options: { depth: 2 } },
    t0,
  );
  assert.ok("connection" in notes);
  assert.equal(connections.disconnect(workspaceId, notes.connection.id, later(1)), true);
  assert.equal(connections.disconnect(workspaceId, notes.connection.id, later(2)), false);
  const tombstone = connections.get(workspaceId, notes.connection.id);
  assert.deepEqual(tombstone, {
    ...notes.connection,
    options: {},
    disconnectedAt: later(1),
  });
  assert.deepEqual(connections.live(workspaceId, "folder"), []);
  assert.equal(connections.configure(workspaceId, notes.connection.id, { depth: 3 }), false);

  // Another folder takes the next number, never the tombstone's.
  assert.deepEqual(connections.planned(workspaceId, "folder", "/Users/pm/plans"), { number: 2 });
  const plans = connections.connect(
    workspaceId,
    { id: id(), kind: "folder", identity: "/Users/pm/plans", options: {} },
    later(3),
  );
  assert.ok("connection" in plans);
  assert.equal(plans.connection.prefix, "folder.2");

  // The same folder again is the same connection, under its ID and number.
  assert.deepEqual(connections.planned(workspaceId, "folder", "/Users/pm/notes"), {
    revives: tombstone,
  });
  const back = connections.connect(
    workspaceId,
    { id: id(), kind: "folder", identity: "/Users/pm/notes", options: {} },
    later(4),
  );
  assert.deepEqual(back, {
    connection: { ...notes.connection, options: {}, connectedAt: later(4) },
    revived: true,
  });
  assert.deepEqual(
    connections.list(workspaceId).map((c) => [c.prefix, c.disconnectedAt]),
    [
      ["folder", null],
      ["folder.2", null],
    ],
  );
});

test("a live connection's options change in place", () => {
  const { id, workspaceId, connections } = fresh();
  const made = connections.connect(
    workspaceId,
    { id: id(), kind: "jira", identity: acme, options: { project: "SYN" } },
    t0,
  );
  assert.ok("connection" in made);
  assert.equal(connections.configure(workspaceId, made.connection.id, { project: "ACME" }), true);
  assert.deepEqual(connections.get(workspaceId, made.connection.id)?.options, {
    project: "ACME",
  });
});

test("a live connection's name and how often it syncs change in place, and a tombstone keeps neither", () => {
  const { id, workspaceId, connections } = fresh();
  const made = connections.connect(
    workspaceId,
    { id: id(), kind: "jira", identity: acme, options: { project: "SYN" } },
    t0,
  );
  assert.ok("connection" in made);
  const { connection } = made;
  assert.equal(connections.settle(workspaceId, connection.id, { name: "Ours", every: 15 }), true);
  const set = connections.get(workspaceId, connection.id);
  assert.deepEqual([set?.name, set?.every, set?.options], ["Ours", 15, { project: "SYN" }]);
  connections.disconnect(workspaceId, connection.id, later(1));
  const gone = connections.get(workspaceId, connection.id);
  assert.deepEqual([gone?.name, gone?.every], [null, null]);
  // Only a live one is set.
  assert.equal(connections.settle(workspaceId, connection.id, { name: "Ours", every: 5 }), false);
});
