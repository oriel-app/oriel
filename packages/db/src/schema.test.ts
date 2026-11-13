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

function withThread() {
  const { db, workspaceId } = fresh();
  db.exec(`
    insert into workstreams values ('g1', '${workspaceId}', 'Checkout', '{"kind":"picked"}', '${now}');
    insert into workstream_changes values ('${workspaceId}', 'g1', 1, '${now}', '{"kind":"user"}');
    insert into threads values ('t1', '${workspaceId}', 'g1', 1, null, '${now}');
  `);
  return { db, workspaceId };
}

function withChangeSet() {
  const { db, workspaceId } = withThread();
  db.exec(
    `insert into change_sets (id, workspace_id, thread_id, run_id, revert_of, created_at) values ('c1', '${workspaceId}', 't1', null, null, '${now}');`,
  );
  return { db, workspaceId };
}

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
  db.exec(
    `insert into change_sets (id, workspace_id, thread_id, run_id, revert_of, created_at) values ('c2', '${workspaceId}', 't1', null, null, '${now}');`,
  );
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
