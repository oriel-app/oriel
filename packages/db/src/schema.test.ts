import assert from "node:assert/strict";
import { test } from "node:test";
import { instant, ulid } from "@oriel/core";
import { loadMigrations, migrate } from "./migrate.ts";
import { open } from "./open.ts";
import { ensureWorkspace } from "./workspaces.ts";

const now = instant(new Date(Date.UTC(2026, 9, 29)));

function fresh() {
  const db = open(":memory:");
  migrate(db, loadMigrations(), now);
  const workspaceId = ulid(0, new Uint8Array(10));
  ensureWorkspace(db, { id: workspaceId, name: "test" }, now);
  return { db, workspaceId };
}

test("every table except the runner's own carries workspace_id", () => {
  const { db } = fresh();
  const tables = db
    .prepare(
      "select name from sqlite_master where type = 'table' and name not in ('workspaces', 'schema_migrations')",
    )
    .all()
    .map((row) => String(row.name));
  for (const table of tables) {
    const columns = db
      .prepare(`pragma table_info(${table})`)
      .all()
      .map((row) => String(row.name));
    assert.ok(columns.includes("workspace_id"), table);
  }
});

test("rows must belong to an existing workspace", () => {
  const { db } = fresh();
  assert.throws(
    () =>
      db
        .prepare(
          "insert into telemetry_events (id, workspace_id, name, at, data) values (?, ?, ?, ?, ?)",
        )
        .run("e1", "no-such-workspace", "source.connected", now, "{}"),
    /FOREIGN KEY/,
  );
});

test("JSON columns reject malformed JSON", () => {
  const { db, workspaceId } = fresh();
  assert.throws(
    () =>
      db
        .prepare(
          "insert into telemetry_events (id, workspace_id, name, at, data) values (?, ?, ?, ?, ?)",
        )
        .run("e1", workspaceId, "source.connected", now, "{not json"),
    /CHECK/,
  );
});

test("mutation status is one of pending, applied, failed", () => {
  const { db, workspaceId } = fresh();
  db.exec(`
    insert into regions values ('r1', '${workspaceId}', '{"kind":"picked"}', 0, '${now}');
    insert into threads values ('t1', '${workspaceId}', 'r1', '${now}');
    insert into change_sets values ('c1', '${workspaceId}', 't1', null, 'h', null, '${now}');
  `);
  const insert = db.prepare(
    "insert into mutations (id, workspace_id, change_set_id, seq, op, args, status) values (?, ?, 'c1', ?, 'setEstimate', '{}', ?)",
  );
  insert.run("m1", workspaceId, 1, "pending");
  assert.throws(() => insert.run("m2", workspaceId, 2, "sent"), /CHECK/);
  assert.throws(() => insert.run("m3", workspaceId, 1, "pending"), /UNIQUE/);
});

function withChangeSet() {
  const { db, workspaceId } = fresh();
  db.exec(`
    insert into regions values ('r1', '${workspaceId}', '{"kind":"picked"}', 0, '${now}');
    insert into threads values ('t1', '${workspaceId}', 'r1', '${now}');
    insert into change_sets values ('c1', '${workspaceId}', 't1', null, 'h', null, '${now}');
  `);
  return { db, workspaceId };
}

test("a mutation's applied result is set exactly when it is applied", () => {
  const { db, workspaceId } = withChangeSet();
  const insert = db.prepare(
    "insert into mutations (id, workspace_id, change_set_id, seq, op, args, status, applied) values (?, ?, 'c1', ?, 'setEstimate', '{}', ?, ?)",
  );
  insert.run("m1", workspaceId, 1, "applied", "{}");
  assert.throws(() => insert.run("m2", workspaceId, 2, "applied", null), /CHECK/);
  assert.throws(() => insert.run("m3", workspaceId, 3, "pending", "{}"), /CHECK/);
});

test("two creates in one change set can't share a ref", () => {
  const { db, workspaceId } = withChangeSet();
  const insert = db.prepare(
    "insert into mutations (id, workspace_id, change_set_id, seq, op, ref, args, status) values (?, ?, 'c1', ?, 'createStory', ?, '{}', 'pending')",
  );
  insert.run("m1", workspaceId, 1, "new:1");
  insert.run("m2", workspaceId, 2, null);
  insert.run("m3", workspaceId, 3, null);
  assert.throws(() => insert.run("m4", workspaceId, 4, "new:1"), /UNIQUE/);
});

test("decisions are ordered by seq, never by timestamp", () => {
  const { db, workspaceId } = withChangeSet();
  const insert = db.prepare(
    "insert into decisions (id, workspace_id, change_set_id, seq, kind, via, by_name, hash, at) values (?, ?, 'c1', ?, ?, 'thread', 'pm', 'h', ?)",
  );
  insert.run("d1", workspaceId, 1, "approved", now);
  insert.run("d2", workspaceId, 2, "rejected", now);
  assert.throws(() => insert.run("d3", workspaceId, 2, "approved", now), /UNIQUE/);
  const latest = db
    .prepare("select kind from decisions where change_set_id = 'c1' order by seq desc limit 1")
    .get();
  assert.equal(latest?.kind, "rejected");
});

test("a change set has at most one live review link", () => {
  const { db, workspaceId } = withChangeSet();
  const insert = db.prepare(
    "insert into review_links (token_hash, workspace_id, change_set_id, created_at, expires_at, revoked_at) values (?, ?, 'c1', ?, ?, ?)",
  );
  insert.run("h1", workspaceId, now, now, now);
  insert.run("h2", workspaceId, now, now, null);
  assert.throws(() => insert.run("h3", workspaceId, now, now, null), /UNIQUE/);
});
