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

  assert.deepEqual(connections.planned(workspaceId, "folder", "/Users/pm/plans"), { number: 2 });
  const plans = connections.connect(
    workspaceId,
    { id: id(), kind: "folder", identity: "/Users/pm/plans", options: {} },
    later(3),
  );
  assert.ok("connection" in plans);
  assert.equal(plans.connection.prefix, "folder.2");

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
