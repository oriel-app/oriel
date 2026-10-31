// The sources table follows core's source kinds, and a migration that adds
// one keeps every source's cursor and last sync.
import assert from "node:assert/strict";
import { test } from "node:test";
import { instant, sourceKinds, ulid } from "@oriel/core";
import { loadMigrations, migrate } from "./migrate.ts";
import { open } from "./open.ts";
import { ensureWorkspace } from "./workspaces.ts";

const now = instant(new Date(Date.UTC(2026, 9, 31)));
const workspaceId = ulid(0, new Uint8Array(10));
const insert = "insert into sources (workspace_id, kind, cursor, synced_at) values (?, ?, ?, ?)";

test("every source kind core knows can sync, and nothing else", () => {
  const db = open(":memory:");
  migrate(db, loadMigrations(), now);
  ensureWorkspace(db, { id: workspaceId, name: "test" }, now);
  for (const kind of sourceKinds) db.prepare(insert).run(workspaceId, kind, null, now);
  assert.throws(() => db.prepare(insert).run(workspaceId, "chat", null, now), /CHECK/);
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
  migrate(db, migrations, now);
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
