import assert from "node:assert/strict";
import { test } from "node:test";
import { instant, ulid } from "@oriel/core";
import { indexStore } from "./index-store.ts";
import { loadMigrations, migrate } from "./migrate.ts";
import { open } from "./open.ts";
import { ensureWorkspace } from "./workspaces.ts";

const now = instant(new Date(Date.UTC(2026, 9, 31)));
const workspaceId = ulid(0, new Uint8Array(10));
const insert = "insert into sources (workspace_id, kind, cursor, synced_at) values (?, ?, ?, ?)";
const beforeConnections = () => loadMigrations().filter((m) => m.version < 20);
const beforeItemText = () => loadMigrations().filter((m) => m.version < 25);

test("a kind no migration names can sync, and taking any keeps each source's cursor", () => {
  const db = open(":memory:");
  const migrations = loadMigrations();
  const any = migrations.findIndex((m) => m.name === "any_source_kind");
  assert.ok(any > 0);
  migrate(db, migrations.slice(0, any), now);
  ensureWorkspace(db, { id: workspaceId, name: "test" }, now);
  db.prepare(insert).run(workspaceId, "jira", "2026-10-30T09:00:00.000Z", now);
  assert.throws(() => db.prepare(insert).run(workspaceId, "sheets", null, now), /CHECK/);
  migrate(db, beforeConnections(), now);
  db.prepare(insert).run(workspaceId, "sheets", null, now);
  assert.deepEqual(
    db
      .prepare("select kind, cursor, synced_at from sources order by kind")
      .all()
      .map((row) => ({ ...row })),
    [
      { kind: "jira", cursor: "2026-10-30T09:00:00.000Z", synced_at: now },
      { kind: "sheets", cursor: null, synced_at: now },
    ],
  );
});

test("adding Slack keeps each source's cursor and last sync", () => {
  const db = open(":memory:");
  const migrations = loadMigrations();
  const slack = migrations.findIndex((m) => m.name === "slack_source");
  assert.ok(slack > 0);
  migrate(db, migrations.slice(0, slack), now);
  ensureWorkspace(db, { id: workspaceId, name: "test" }, now);
  db.prepare(insert).run(workspaceId, "jira", "2026-10-30T09:00:00.000Z", now);
  db.prepare(insert).run(workspaceId, "folder", null, now);
  migrate(db, beforeConnections(), now);
  assert.deepEqual(
    db
      .prepare("select kind, cursor, synced_at from sources order by kind")
      .all()
      .map((row) => ({ ...row })),
    [
      { kind: "folder", cursor: null, synced_at: now },
      { kind: "jira", cursor: "2026-10-30T09:00:00.000Z", synced_at: now },
    ],
  );
  db.prepare(insert).run(workspaceId, "slack", null, now);
});

test("connections name each source's column for what it holds, a connection's prefix, and keep every row", () => {
  const db = open(":memory:");
  migrate(db, beforeConnections(), now);
  ensureWorkspace(db, { id: workspaceId, name: "test" }, now);
  db.prepare(insert).run(workspaceId, "jira", "2026-10-30T09:00:00.000Z", now);
  db.prepare(insert).run(workspaceId, "slack", null, now);
  const folderId = ulid(1, new Uint8Array(10));
  db.prepare("insert into folders (id, workspace_id, path, connected_at) values (?, ?, ?, ?)").run(
    folderId,
    workspaceId,
    "/Users/pm/notes",
    now,
  );
  migrate(db, beforeItemText(), now);
  const rows = (sql: string) =>
    db
      .prepare(sql)
      .all()
      .map((row) => ({ ...row }));
  assert.deepEqual(rows("select source, cursor, synced_at from sources order by source"), [
    { source: "jira", cursor: "2026-10-30T09:00:00.000Z", synced_at: now },
    { source: "slack", cursor: null, synced_at: now },
  ]);
  assert.deepEqual(
    rows(
      "select id, kind, number, identity, name, options, connected_at, disconnected_at from connections",
    ),
    [
      {
        id: folderId,
        kind: "folder",
        number: 1,
        identity: "/Users/pm/notes",
        name: null,
        options: "{}",
        connected_at: now,
        disconnected_at: null,
      },
    ],
  );
  assert.deepEqual(rows("select name from sqlite_master where name = 'folders'"), []);
});

test("keeping item text starts every cursor over, keeping each source's last sync, so the next sync is a full one", () => {
  const db = open(":memory:");
  migrate(db, beforeItemText(), now);
  ensureWorkspace(db, { id: workspaceId, name: "test" }, now);
  db.prepare(
    "insert into sources (workspace_id, source, cursor, synced_at) values (?, ?, ?, ?)",
  ).run(workspaceId, "jira", "2026-10-30T09:00:00.000Z", now);
  migrate(db, loadMigrations(), now);
  const index = indexStore(db);
  assert.equal(index.source(workspaceId, "jira")?.cursor, null);
  assert.equal(index.source(workspaceId, "jira")?.syncedAt, now);
});
