import { DatabaseSync } from "node:sqlite";

// One connection per process. `:memory:` gives each test its own database.
export function open(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("pragma foreign_keys = on; pragma busy_timeout = 5000;");
  if (path !== ":memory:") db.exec("pragma journal_mode = wal;");
  return db;
}

// Runs `work` in one immediate transaction: everything commits or nothing does.
export function transaction<T>(db: DatabaseSync, work: () => T): T {
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
