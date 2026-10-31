// The sources table follows core's source kinds, a migration that adds one
// keeps every source's cursor and last sync, and search can leave a source
// out.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type Instant, instant, type ItemId, sourceKinds, ulid, unknown } from "@oriel/core";
import { indexStore } from "./index-store.ts";
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

test("search leaves out a source it isn't given before it ranks, so that source can't crowd out the rest", () => {
  const db = open(":memory:");
  migrate(db, loadMigrations(), now);
  ensureWorkspace(db, { id: workspaceId, name: "test" }, now);
  const index = indexStore(db);
  const record = (id: string, title: string, updatedAt: string) => ({
    id: id as ItemId,
    stableId: id.slice(id.indexOf(":") + 1),
    title,
    location: "https://example.com/",
    updatedAt: updatedAt as Instant,
    facets: {},
    attrs: {},
  });
  const sync = (kind: "jira" | "slack", records: ReturnType<typeof record>[]) => {
    const run = index.beginSync(workspaceId, kind, unknown, now);
    run.apply({ records, gone: [], cursor: null });
    run.finish(null, now);
  };
  sync("jira", [record("jira:SYN-1", "SMS wording", "2026-01-01T00:00:00.000Z")]);
  // Sixty newer Slack messages: more than a search returns.
  sync(
    "slack",
    Array.from({ length: 60 }, (_, i) =>
      record(`slack:C0FW1WEATHR-17884440${String(i).padStart(2, "0")}.000100`, `SMS ${i}`, now),
    ),
  );
  assert.equal(index.search(workspaceId, "SMS", 20).length, 20);
  assert.ok(index.search(workspaceId, "SMS", 20).every((r) => r.id.startsWith("slack:")));
  assert.deepEqual(
    index.search(workspaceId, "SMS", 20, ["jira", "folder"]).map((r) => r.id),
    ["jira:SYN-1"],
  );
});
