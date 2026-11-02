import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { array, instant, object, string, type Ulid } from "@oriel/core";
import { indexStore } from "./index-store.ts";
import { loadMigrations, migrate } from "./migrate.ts";
import { open } from "./open.ts";

const now = instant(new Date(Date.UTC(2026, 9, 29)));
// Migrations before 0012 named workstreams groups: a test of one of them
// stops before it.
const beforeWorkstreams = () => loadMigrations().filter((m) => m.version < 12);
const tables = (db: ReturnType<typeof open>) =>
  db
    .prepare("select name from sqlite_master where type = 'table' order by name")
    .all()
    .map((row) => String(row.name));

test("a fresh database gets every migration, once", () => {
  const db = open(":memory:");
  const migrations = loadMigrations();
  assert.deepEqual(
    migrate(db, migrations, now),
    migrations.map((m) => m.version),
  );
  assert.ok(tables(db).includes("items"));
  assert.ok(tables(db).includes("change_sets"));
  assert.deepEqual(migrate(db, migrations, now), []);
});

test("an applied migration that was edited stops the runner", () => {
  const db = open(":memory:");
  migrate(db, [{ version: 1, name: "a", sql: "create table a (x text) strict;" }], now);
  assert.throws(
    () =>
      migrate(db, [{ version: 1, name: "a", sql: "create table a (x text, y text) strict;" }], now),
    /edited after it was applied/,
  );
});

test("a database ahead of the code stops the runner", () => {
  const db = open(":memory:");
  migrate(db, [{ version: 1, name: "a", sql: "create table a (x text) strict;" }], now);
  assert.throws(() => migrate(db, [], now), /doesn't know/);
});

test("a failing migration leaves nothing behind", () => {
  const db = open(":memory:");
  const migrations = [
    { version: 1, name: "a", sql: "create table a (x text) strict;" },
    { version: 2, name: "b", sql: "create table b (x text) strict; select nope from nowhere;" },
  ];
  assert.throws(() => migrate(db, migrations, now), /no such table/);
  assert.deepEqual(tables(db), ["a", "schema_migrations"]);
  assert.deepEqual(
    db
      .prepare("select version from schema_migrations")
      .all()
      .map((r) => Number(r.version)),
    [1],
  );
});

test("migration files must be numbered from 0001 without gaps", () => {
  const dir = mkdtempSync(join(tmpdir(), "oriel-migrations-"));
  writeFileSync(join(dir, "0001_init.sql"), "select 1;");
  writeFileSync(join(dir, "0003_skip.sql"), "select 1;");
  assert.throws(() => loadMigrations(pathToFileURL(`${dir}/`)), /no gaps/);
  writeFileSync(join(dir, "0002 bad name.sql"), "select 1;");
  assert.throws(() => loadMigrations(pathToFileURL(`${dir}/`)), /NNNN_name\.sql/);
});

test("a migration that leaves a dangling foreign key is rolled back", () => {
  const db = open(":memory:");
  const migrations = [
    { version: 1, name: "a", sql: "create table a (id text primary key) strict;" },
    {
      version: 2,
      name: "b",
      sql: "create table b (a_id text references a (id)) strict; insert into b values ('missing');",
    },
  ];
  assert.throws(() => migrate(db, migrations, now), /breaks foreign keys/);
  assert.deepEqual(tables(db), ["a", "schema_migrations"]);
  assert.equal(db.prepare("pragma foreign_keys").get()?.foreign_keys, 1);
});

test("0002 turns each region into a group at version 1, and keeps its threads and runs", () => {
  const db = open(":memory:");
  const [first, ...rest] = beforeWorkstreams();
  assert.ok(first);
  migrate(db, [first], now);
  db.exec(`
    insert into workspaces values ('w1', 'test', '${now}');
    insert into regions values ('r1', 'w1', '{"kind":"group","grouping":"epic","cluster":"10001","anchor":"jira:SYN-1"}', 3, '${now}');
    insert into region_items values ('w1', 'r1', 1, 'jira', '10001', 'jira:SYN-1');
    insert into region_items values ('w1', 'r1', 2, 'jira', '10013', 'jira:SYN-13');
    insert into threads values ('t1', 'w1', 'r1', '${now}');
    insert into runs values ('u1', 'w1', 't1', 3, 'p', 'd', 'model', 1, 2, 3, 'ok', '${now}');
    insert into run_reads values ('w1', 'u1', 1, 'jira.listItems', '[]', 4, 0, 'h');
    insert into items values ('w1', 'jira', '10001', 'jira:SYN-1', 'Epic', 'https://x/SYN-1', '${now}', '{}', 3, null);
  `);
  migrate(db, [first, ...rest], now);
  const all = (sql: string) =>
    db
      .prepare(sql)
      .all()
      .map((row) => ({ ...row }));
  assert.deepEqual(all("select id, name, origin from groups"), [
    {
      id: "r1",
      name: "",
      origin:
        '{"kind":"cluster","grouping":"epic","cluster":"10001","anchor":{"id":"jira:SYN-1","stableId":"10001"}}',
    },
  ]);
  assert.deepEqual(
    all("select item_id, added_version, removed_version from group_members order by item_id"),
    [
      { item_id: "jira:SYN-1", added_version: 1, removed_version: null },
      { item_id: "jira:SYN-13", added_version: 1, removed_version: null },
    ],
  );
  assert.deepEqual(all("select id, group_id, region_version, marked_done_at from threads"), [
    { id: "t1", group_id: "r1", region_version: 1, marked_done_at: null },
  ]);
  assert.deepEqual(all("select id, region_version, cold_start_ms, outcome from runs"), [
    { id: "u1", region_version: 1, cold_start_ms: null, outcome: "ok" },
  ]);
  assert.deepEqual(all("select status, payload_hash from run_reads"), [
    { status: "answered", payload_hash: "h" },
  ]);
  assert.deepEqual(all("select location, facets from items"), [
    { location: "https://x/SYN-1", facets: "{}" },
  ]);
  assert.ok(!tables(db).includes("regions") && !tables(db).includes("region_items"));
  assert.deepEqual(db.prepare("pragma foreign_key_check").all(), []);
});

test("0002 rewrites the index's old Jira rows readably and starts every sync over", () => {
  const db = open(":memory:");
  const [first, ...rest] = loadMigrations();
  assert.ok(first);
  migrate(db, [first], now);
  // As 0001's index kept them: everything Jira's in attrs.
  const old = (fields: Record<string, unknown>) =>
    JSON.stringify({
      issueType: "Story",
      status: { name: "In Review", category: "in-progress" },
      epic: null,
      assignee: null,
      points: null,
      labels: [],
      ...fields,
    });
  const insert = db.prepare(
    "insert into items values ('w1', 'jira', ?, ?, 'Title', 'https://x', ?, ?, 3, null)",
  );
  db.exec(`
    insert into workspaces values ('w1', 'test', '${now}');
    insert into sources values ('w1', 'jira', '2026-10-28T09:00:00.000Z', '${now}');
  `);
  insert.run(
    "10001",
    "jira:SYN-1",
    now,
    old({ issueType: "Epic", status: { name: "Done", category: "done" } }),
  );
  insert.run(
    "10003",
    "jira:SYN-3",
    now,
    old({
      epic: "jira:SYN-1",
      assignee: { accountId: "amara", name: "Amara Okafor" },
      points: 3,
      labels: ["payments"],
    }),
  );
  // Its epic isn't in the index.
  insert.run("10004", "jira:SYN-4", now, old({ epic: "jira:SYN-9" }));
  migrate(db, [first, ...rest], now);

  const attrs = object({ issueType: string, status: string, labels: array(string) });
  const records = indexStore(db).records("w1" as Ulid, "jira", attrs);
  assert.deepEqual(
    records.map(({ id, facets, attrs }) => ({ id, facets, attrs })),
    [
      {
        id: "jira:SYN-1",
        facets: { people: [], state: "done", container: null, kind: "epic", estimate: null },
        attrs: { issueType: "Epic", status: "Done", labels: [] },
      },
      {
        id: "jira:SYN-3",
        facets: {
          people: [{ role: "assignee", id: "amara", name: "Amara Okafor" }],
          state: "in-progress",
          container: { id: "jira:SYN-1", stableId: "10001" },
          kind: "story",
          estimate: 3,
        },
        attrs: { issueType: "Story", status: "In Review", labels: ["payments"] },
      },
      {
        id: "jira:SYN-4",
        facets: {
          people: [],
          state: "in-progress",
          container: { id: "jira:SYN-9", stableId: "" },
          kind: "story",
          estimate: null,
        },
        attrs: { issueType: "Story", status: "In Review", labels: [] },
      },
    ],
  );
  // The old attrs' shape is gone: a reader of the old shape would fail now.
  assert.throws(
    () =>
      indexStore(db).records("w1" as Ulid, "jira", object({ status: object({ name: string }) })),
    /attrs don't match/,
  );
  assert.deepEqual(indexStore(db).source("w1" as Ulid, "jira"), { cursor: null, syncedAt: now });
});

test("groups made before names were attributed are the user's, unless the name is still Oriel's", () => {
  const db = open(":memory:");
  const migrations = beforeWorkstreams();
  const before = migrations.findIndex((m) => m.name === "user_named_groups");
  assert.ok(before > 0);
  migrate(db, migrations.slice(0, before), now);
  const workspaceId = "01JBZ00000000000000000000W";
  const cluster = (stableId: string) =>
    JSON.stringify({
      kind: "cluster",
      grouping: "epic",
      cluster: stableId,
      anchor: { id: `jira:SYN-${stableId}`, stableId },
    });
  db.prepare("insert into workspaces (id, name, created_at) values (?, 'w', ?)").run(
    workspaceId,
    now,
  );
  const item = db.prepare(`
    insert into items (workspace_id, source, stable_id, item_id, title, location, updated_at,
      attrs, snapshot, gone_at)
    values (?, 'jira', ?, ?, ?, 'https://example.com', ?, '{}', 1, ?)`);
  item.run(workspaceId, "1", "jira:SYN-1", "Checkout", now, null);
  item.run(workspaceId, "2", "jira:SYN-2", "Search, renamed", now, null);
  item.run(workspaceId, "3", "jira:SYN-3", "Billing", now, now);
  item.run(workspaceId, "4", "jira:SYN-4", "x".repeat(130), now, null);
  const group = db.prepare(
    "insert into groups (id, workspace_id, name, origin, created_at) values (?, ?, ?, ?, ?)",
  );
  group.run("still-epic", workspaceId, "Checkout", cluster("1"), now);
  group.run("epic-renamed-or-user", workspaceId, "Search", cluster("2"), now);
  group.run("epic-gone", workspaceId, "Billing", cluster("3"), now);
  group.run("epic-long", workspaceId, "x".repeat(120), cluster("4"), now);
  group.run("from-0002", workspaceId, "", cluster("2"), now);
  group.run("untitled", workspaceId, "Untitled", cluster("1"), now);
  group.run("thread-blank", workspaceId, "New group", '{"kind":"thread"}', now);
  group.run("thread-named", workspaceId, "Launch", '{"kind":"thread"}', now);
  group.run("picked", workspaceId, "2 items", '{"kind":"picked"}', now);
  migrate(db, migrations, now);
  assert.deepEqual(
    db
      .prepare("select group_id from user_named_groups order by group_id")
      .all()
      .map((row) => String(row.group_id)),
    ["epic-renamed-or-user", "picked", "thread-named"],
  );
});

test("0012 renames groups to workstreams and keeps every row", () => {
  const db = open(":memory:");
  migrate(db, beforeWorkstreams(), now);
  const workspaceId = "01JBZ00000000000000000000W";
  db.exec(`
    insert into workspaces values ('${workspaceId}', 'w', '${now}');
    insert into groups values ('blank', '${workspaceId}', 'New group', '{"kind":"thread"}', '${now}');
    insert into groups values ('kept', '${workspaceId}', 'New group', '{"kind":"thread"}', '${now}');
    insert into groups values ('picked', '${workspaceId}', 'New group', '{"kind":"picked"}', '${now}');
    insert into user_named_groups values ('${workspaceId}', 'kept');
    insert into group_changes values ('${workspaceId}', 'picked', 1, '${now}', '{"kind":"user"}');
    insert into group_changes values ('${workspaceId}', 'picked', 2, '${now}', '{"kind":"user"}');
    insert into group_changes values ('${workspaceId}', 'blank', 1, '${now}', '{"kind":"user"}');
    insert into group_members values ('${workspaceId}', 'picked', 'jira', '1', 'jira:SYN-1', 1, 2);
    insert into group_members values ('${workspaceId}', 'picked', 'jira', '2', 'jira:SYN-2', 1, null);
    insert into threads (id, workspace_id, group_id, region_version, created_at)
      values ('t1', '${workspaceId}', 'picked', 2, '${now}');
  `);
  const rows = (table: string) =>
    db
      .prepare(`select * from ${table} order by rowid`)
      .all()
      .map((row) => Object.values(row));
  const before = ["groups", "group_changes", "group_members", "user_named_groups", "threads"].map(
    rows,
  );
  assert.deepEqual(
    migrate(
      db,
      loadMigrations().filter((m) => m.version <= 12),
      now,
    ),
    [12],
  );
  const after = [
    "workstreams",
    "workstream_changes",
    "workstream_members",
    "user_named_workstreams",
    "threads",
  ].map(rows);
  // Only Oriel's blank name for a thread's workstream changes.
  const named = before[0]?.map((row) =>
    row[0] === "blank" ? ["blank", ...row.slice(1, 2), "New workstream", ...row.slice(3)] : row,
  );
  assert.deepEqual(after, [named, ...before.slice(1)]);
  assert.ok(!tables(db).some((table) => table.includes("group")));
  const columns = (table: string) =>
    db
      .prepare(`select name from pragma_table_info('${table}')`)
      .all()
      .map((row) => String(row.name));
  assert.ok(columns("threads").includes("workstream_id"));
  assert.deepEqual(
    db
      .prepare(
        "select name from sqlite_master where type = 'index' and name not like 'sqlite_%' and sql like '%workstream%' order by name",
      )
      .all()
      .map((row) => String(row.name)),
    ["threads_by_workstream", "workstream_members_live", "workstreams_by_workspace"],
  );
  // The foreign keys follow the renamed tables.
  assert.throws(() =>
    db.exec(
      `insert into threads (id, workspace_id, workstream_id, region_version, created_at) values ('t2', '${workspaceId}', 'nope', 1, '${now}')`,
    ),
  );
  assert.deepEqual(db.prepare("pragma foreign_key_check").all(), []);
});
