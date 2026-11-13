import { DatabaseSync } from "node:sqlite";
import { indexFold } from "@oriel/core";

// `exclusive` holds SQLite's exclusive lock until close, so no other connection, in any process,
// can read or write the file; a second opener is refused at once rather than after the busy wait.
export function open(path: string, options: { exclusive?: boolean } = {}): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("pragma foreign_keys = on;");
  db.function("search_fold", { deterministic: true }, (text) =>
    indexFold(typeof text === "string" ? text : ""),
  );
  if (options.exclusive) {
    // Before WAL is first used, so the WAL needs no shared memory, and taken
    // now, not at the first write.
    db.exec("pragma locking_mode = exclusive; pragma busy_timeout = 0;");
    try {
      db.exec("begin exclusive; commit;");
    } catch (error) {
      db.close();
      throw error;
    }
  }
  db.exec("pragma busy_timeout = 5000;");
  if (path !== ":memory:") db.exec("pragma journal_mode = wal;");
  return db;
}
export function transaction<T>(db: DatabaseSync, work: () => T): T {
  if (db.isTransaction) return work();
  db.exec("begin immediate");
  try {
    const result = work();
    db.exec("commit");
    return result;
  } catch (error) {
    // SQLite may already have rolled back; a second rollback would hide the error.
    if (db.isTransaction) db.exec("rollback");
    throw error;
  }
}
