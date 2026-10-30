import type { DatabaseSync } from "node:sqlite";
import { type Instant, isUlid, object, refine, string, type Ulid } from "@oriel/core";

const idRow = object({ id: refine(string, isUlid, "expected a ULID") });

export function ensureWorkspace(
  db: DatabaseSync,
  workspace: { id: Ulid; name: string },
  now: Instant,
): void {
  db.prepare(
    "insert into workspaces (id, name, created_at) values (?, ?, ?) on conflict (id) do nothing",
  ).run(workspace.id, workspace.name, now);
}

// The workspace this database holds, the oldest if it holds more than one,
// or null before there is any (SPEC §7: one workspace for now).
export function firstWorkspace(db: DatabaseSync): Ulid | null {
  const raw = db.prepare("select id from workspaces order by created_at, id limit 1").get();
  if (!raw) return null;
  const row = idRow(raw);
  if (!row.ok) throw new Error(`corrupt workspaces row: ${JSON.stringify(row.issues)}`);
  return row.value.id;
}
