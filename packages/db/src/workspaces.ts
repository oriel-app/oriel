import type { DatabaseSync } from "node:sqlite";
import {
  type Instant,
  isInstant,
  isUlid,
  number,
  object,
  refine,
  string,
  type Ulid,
} from "@oriel/core";

const idRow = object({ id: refine(string, isUlid, "expected a ULID") });
const seenRow = object({
  seen_at: refine(string, isInstant, "expected an instant"),
  seen_seq: number,
});

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

// When the user last left the overview, and the last change log entry that
// had committed then, or null before they ever have. What committed after
// it is what they haven't seen (decision 0027).
export function lastSeen(db: DatabaseSync, workspaceId: Ulid): { at: Instant; seq: number } | null {
  const raw = db
    .prepare("select seen_at, seen_seq from overview_seen where workspace_id = ?")
    .get(workspaceId);
  if (!raw) return null;
  const row = seenRow(raw);
  if (!row.ok) throw new Error(`corrupt overview_seen row: ${JSON.stringify(row.issues)}`);
  return { at: row.value.seen_at, seq: row.value.seen_seq };
}

// The user left the overview at `at`, having seen the change log up to
// entry `seq` (no further than what has committed): the stamp moves there,
// and never back.
export function markSeen(db: DatabaseSync, workspaceId: Ulid, at: Instant, seq: number): void {
  db.prepare(`
    insert into overview_seen (workspace_id, seen_at, seen_seq)
      values (?, ?, min(?, coalesce((select max(seq) from change_log), 0)))
    on conflict (workspace_id) do update set
      seen_at = max(seen_at, excluded.seen_at), seen_seq = max(seen_seq, excluded.seen_seq)`).run(
    workspaceId,
    at,
    seq,
  );
}
