import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { type Instant, number, object, string } from "@oriel/core";
import { transaction } from "./open.ts";

export type Migration = { version: number; name: string; sql: string };

const defaultDir = new URL("../migrations/", import.meta.url);

// Numbered files `NNNN_name.sql`, consecutive from 0001.
export function loadMigrations(dir: URL = defaultDir): Migration[] {
  const migrations = readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => {
      const match = /^(\d{4})_([a-z0-9_]+)\.sql$/.exec(file);
      if (!match) throw new Error(`migration file must be NNNN_name.sql: ${file}`);
      return {
        version: Number(match[1]),
        name: match[2] ?? "",
        sql: readFileSync(new URL(file, dir), "utf8"),
      };
    });
  migrations.forEach((m, i) => {
    if (m.version !== i + 1) {
      throw new Error(
        `migrations must be numbered from 0001 with no gaps; found ${m.version} at position ${i + 1}`,
      );
    }
  });
  return migrations;
}

const checksum = (sql: string) => createHash("sha256").update(sql).digest("hex");

const appliedRow = object({ version: number, name: string, checksum: string });

// Applies what's missing, each migration in its own transaction. Refuses to run
// if an applied migration's file changed, or if the database is ahead of the
// code. Safe when two processes start at once: each migration re-checks inside
// its write transaction. Foreign keys are off while migrating, so a migration
// can rebuild a referenced table (SQLite's procedure), and are verified before
// each commit. Returns the versions it applied.
export function migrate(
  db: DatabaseSync,
  migrations: readonly Migration[],
  now: Instant,
): number[] {
  // The runner's own bookkeeping, so it is the one table without workspace_id.
  db.exec(`create table if not exists schema_migrations (
    version integer primary key,
    name text not null,
    checksum text not null,
    applied_at text not null
  ) strict`);
  const appliedNow = () =>
    db
      .prepare("select version, name, checksum from schema_migrations order by version")
      .all()
      .map((row) => {
        const result = appliedRow(row);
        if (!result.ok) throw new Error(`unreadable schema_migrations row: ${JSON.stringify(row)}`);
        return result.value;
      });
  for (const row of appliedNow()) {
    const known = migrations.find((m) => m.version === row.version);
    if (!known)
      throw new Error(
        `database has migration ${row.version} (${row.name}), which this code doesn't know`,
      );
    if (checksum(known.sql) !== row.checksum) {
      throw new Error(
        `migration ${row.version} (${row.name}) was edited after it was applied; add a new migration instead`,
      );
    }
  }
  const done: number[] = [];
  db.exec("pragma foreign_keys = off");
  try {
    for (const m of migrations) {
      transaction(db, () => {
        if (appliedNow().some((row) => row.version === m.version)) return;
        db.exec(m.sql);
        const violations = db.prepare("pragma foreign_key_check").all();
        if (violations.length)
          throw new Error(
            `migration ${m.version} (${m.name}) breaks foreign keys: ${JSON.stringify(violations)}`,
          );
        db.prepare(
          "insert into schema_migrations (version, name, checksum, applied_at) values (?, ?, ?, ?)",
        ).run(m.version, m.name, checksum(m.sql), now);
        done.push(m.version);
      });
    }
  } finally {
    db.exec("pragma foreign_keys = on");
  }
  return done;
}
