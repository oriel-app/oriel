import type { DatabaseSync } from "node:sqlite";
import type { Instant, Ulid } from "@oriel/core";

export function ensureWorkspace(
  db: DatabaseSync,
  workspace: { id: Ulid; name: string },
  now: Instant,
): void {
  db.prepare(
    "insert into workspaces (id, name, created_at) values (?, ?, ?) on conflict (id) do nothing",
  ).run(workspace.id, workspace.name, now);
}
