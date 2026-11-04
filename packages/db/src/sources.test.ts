// The sources table takes any kind, a migration that rebuilds it keeps every
// source's cursor and last sync, and search can leave a source out.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type Instant, instant, type ItemId, ulid, unknown } from "@oriel/core";
import { indexStore, searchTerms } from "./index-store.ts";
import { loadMigrations, migrate } from "./migrate.ts";
import { open } from "./open.ts";
import { ensureWorkspace } from "./workspaces.ts";

const now = instant(new Date(Date.UTC(2026, 9, 31)));
const workspaceId = ulid(0, new Uint8Array(10));
const insert = "insert into sources (workspace_id, kind, cursor, synced_at) values (?, ?, ?, ?)";
// Migrations before 0020 named the column `kind`: a test of one of them
// stops before it.
const beforeConnections = () => loadMigrations().filter((m) => m.version < 20);

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

test("a term drops only the prefix of a connection the index holds, so text like fix:login stays as written", () => {
  const prefixes = new Set(["jira", "jira.2"]);
  assert.deepEqual(searchTerms("jira:SYN-12 jira.2:ACME-4", prefixes).terms, ["syn-12", "acme-4"]);
  assert.deepEqual(searchTerms("fix:login", prefixes), {
    terms: ["fix:login"],
    whole: "fix:login",
  });
  assert.deepEqual(searchTerms("jira:", prefixes).terms, []);
  assert.equal(searchTerms("jira:SYN-12", prefixes).whole, "syn-12");
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
  migrate(db, loadMigrations(), now);
  const rows = (sql: string) =>
    db
      .prepare(sql)
      .all()
      .map((row) => ({ ...row }));
  assert.deepEqual(rows("select source, cursor, synced_at from sources order by source"), [
    { source: "jira", cursor: "2026-10-30T09:00:00.000Z", synced_at: now },
    { source: "slack", cursor: null, synced_at: now },
  ]);
  // The folder is a connection, under its own ID, which its keys hash.
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
