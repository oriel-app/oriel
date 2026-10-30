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

// A group at version 1 and a working thread on it.
function withThread() {
  const { db, workspaceId } = fresh();
  db.exec(`
    insert into groups values ('g1', '${workspaceId}', 'Checkout', '{"kind":"picked"}', '${now}');
    insert into group_changes values ('${workspaceId}', 'g1', 1, '${now}', '{"kind":"user"}');
    insert into threads values ('t1', '${workspaceId}', 'g1', 1, null, '${now}');
  `);
  return { db, workspaceId };
}

test("mutation status is one of pending, applied, failed", () => {
  const { db, workspaceId } = withThread();
  db.exec(`insert into change_sets values ('c1', '${workspaceId}', 't1', null, null, '${now}');`);
  const insert = db.prepare(
    "insert into mutations (id, workspace_id, change_set_id, seq, op, args, status) values (?, ?, 'c1', ?, 'setEstimate', '{}', ?)",
  );
  insert.run("m1", workspaceId, 1, "pending");
  assert.throws(() => insert.run("m2", workspaceId, 2, "sent"), /CHECK/);
  assert.throws(() => insert.run("m3", workspaceId, 1, "pending"), /UNIQUE/);
});

function withChangeSet() {
  const { db, workspaceId } = withThread();
  db.exec(`insert into change_sets values ('c1', '${workspaceId}', 't1', null, null, '${now}');`);
  return { db, workspaceId };
}

test("a thread's state isn't stored, only when the user marked it done", () => {
  const { db } = withThread();
  const columns = db
    .prepare("pragma table_info(threads)")
    .all()
    .map((row) => String(row.name));
  assert.deepEqual(columns, [
    "id",
    "workspace_id",
    "group_id",
    "region_version",
    "marked_done_at",
    "created_at",
  ]);
});

test("a thread and a member name versions their group has", () => {
  const { db, workspaceId } = withThread();
  assert.throws(
    () =>
      db
        .prepare(
          "insert into threads (id, workspace_id, group_id, region_version, created_at) values ('t2', ?, 'g1', 2, ?)",
        )
        .run(workspaceId, now),
    /FOREIGN KEY/,
  );
  const member = db.prepare(
    "insert into group_members (workspace_id, group_id, source, stable_id, item_id, added_version, removed_version) values (?, 'g1', 'jira', ?, 'jira:SYN-1', ?, ?)",
  );
  member.run(workspaceId, "10001", 1, null);
  assert.throws(() => member.run(workspaceId, "10002", 2, null), /FOREIGN KEY/);
  assert.throws(() => member.run(workspaceId, "10003", 1, 1), /CHECK/);
  // One live row per member, whatever version adds it again.
  db.prepare("insert into group_changes values (?, 'g1', 2, ?, '{\"kind\":\"user\"}')").run(
    workspaceId,
    now,
  );
  assert.throws(() => member.run(workspaceId, "10001", 2, null), /UNIQUE/);
});

test("a run's read has a payload hash and a region flag exactly when it was answered", () => {
  const { db, workspaceId } = withThread();
  db.exec(`
    insert into runs (id, workspace_id, thread_id, snapshot, region_version, system_prompt_hash,
      dts_hash, model, input_tokens, output_tokens, wall_ms, cold_start_ms, outcome, started_at)
    values ('u1', '${workspaceId}', 't1', 1, 1, 'p', 'd', 'model', 0, 0, 0, null, 'aborted', '${now}');
  `);
  const read = db.prepare(
    "insert into run_reads (workspace_id, run_id, seq, fn, args, ms, outside_region, status, payload_hash) values (?, 'u1', ?, 'items.list', '[]', 0, ?, ?, ?)",
  );
  read.run(workspaceId, 1, 0, "answered", "h");
  read.run(workspaceId, 2, null, "failed", null);
  read.run(workspaceId, 3, null, "unanswered", null);
  assert.throws(() => read.run(workspaceId, 4, 0, "answered", null), /CHECK/);
  assert.throws(() => read.run(workspaceId, 5, null, "answered", "h"), /CHECK/);
  assert.throws(() => read.run(workspaceId, 6, null, "failed", "h"), /CHECK/);
  assert.throws(() => read.run(workspaceId, 7, 1, "unanswered", null), /CHECK/);
  assert.throws(() => read.run(workspaceId, 8, null, "late", null), /CHECK/);
});

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
    "insert into review_links (token_hash, workspace_id, change_set_id, created_at, revoked_at) values (?, ?, 'c1', ?, ?)",
  );
  insert.run("h1", workspaceId, now, now);
  insert.run("h2", workspaceId, now, null);
  assert.throws(() => insert.run("h3", workspaceId, now, null), /UNIQUE/);
});

test("a review-link decision names its own change set's link and a typed name", () => {
  const { db, workspaceId } = withChangeSet();
  db.exec(`insert into change_sets values ('c2', '${workspaceId}', 't1', null, null, '${now}');`);
  const link = db.prepare(
    "insert into review_links (token_hash, workspace_id, change_set_id, created_at) values (?, ?, ?, ?)",
  );
  link.run("h1", workspaceId, "c1", now);
  link.run("h2", workspaceId, "c2", now);
  const insert = db.prepare(
    "insert into decisions (id, workspace_id, change_set_id, seq, kind, via, review_link, by_name, hash, at) values (?, ?, 'c1', ?, 'approved', ?, ?, ?, 'h', ?)",
  );
  insert.run("d1", workspaceId, 1, "review-link", "h1", "Sam", now);
  insert.run("d2", workspaceId, 2, "thread", null, "pm", now);
  assert.throws(() => insert.run("d3", workspaceId, 3, "review-link", null, "Sam", now), /CHECK/);
  assert.throws(() => insert.run("d4", workspaceId, 4, "thread", "h1", "pm", now), /CHECK/);
  assert.throws(
    () => insert.run("d5", workspaceId, 5, "review-link", "forged", "Sam", now),
    /FOREIGN KEY/,
  );
  assert.throws(
    () => insert.run("d6", workspaceId, 6, "review-link", "h2", "Sam", now),
    /FOREIGN KEY/,
  );
  assert.throws(() => insert.run("d7", workspaceId, 7, "review-link", "h1", "  ", now), /CHECK/);
});
