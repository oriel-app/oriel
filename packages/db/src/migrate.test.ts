import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { instant } from "@oriel/core";
import { loadMigrations, migrate } from "./migrate.ts";
import { open } from "./open.ts";

const now = instant(new Date(Date.UTC(2026, 9, 29)));
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
  const [first, ...rest] = loadMigrations();
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
      origin: '{"kind":"cluster","grouping":"epic","cluster":"10001","anchor":"jira:SYN-1"}',
    },
  ]);
  assert.deepEqual(
    all("select item_id, added_version, removed_version from group_members order by item_id"),
    [
      { item_id: "jira:SYN-1", added_version: 1, removed_version: null },
      { item_id: "jira:SYN-13", added_version: 1, removed_version: null },
    ],
  );
  assert.deepEqual(all("select id, group_id, region_version, state, done_by from threads"), [
    { id: "t1", group_id: "r1", region_version: 1, state: "working", done_by: null },
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
