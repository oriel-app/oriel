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
