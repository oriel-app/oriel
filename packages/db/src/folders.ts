// The folder a workspace has connected (decision 0019): one, which a new
// pick replaces. Its items are in the index like any source's.
import type { DatabaseSync } from "node:sqlite";
import { type Instant, isInstant, isUlid, object, refine, string, type Ulid } from "@oriel/core";

const folderRow = object({
  id: refine(string, isUlid, "expected a ULID"),
  path: string,
  connected_at: refine(string, isInstant, "expected an instant"),
});

export type ConnectedFolder = { id: Ulid; path: string; connectedAt: Instant };

export type FolderStore = ReturnType<typeof folderStore>;

export function folderStore(db: DatabaseSync) {
  const select = db.prepare("select id, path, connected_at from folders where workspace_id = ?");
  const upsert = db.prepare(`
    insert into folders (id, workspace_id, path, connected_at) values (?, ?, ?, ?)
    on conflict (workspace_id) do update set
      id = excluded.id, path = excluded.path, connected_at = excluded.connected_at`);

  return {
    // The workspace's folder, or null before one is connected.
    get(workspaceId: Ulid): ConnectedFolder | null {
      const raw = select.get(workspaceId);
      if (!raw) return null;
      const row = folderRow(raw);
      if (!row.ok) throw new Error(`corrupt folders row: ${JSON.stringify(row.issues)}`);
      return { id: row.value.id, path: row.value.path, connectedAt: row.value.connected_at };
    },

    // Connects a folder, replacing the one before.
    connect(workspaceId: Ulid, folder: { id: Ulid; path: string }, now: Instant): void {
      upsert.run(folder.id, workspaceId, folder.path, now);
    },
  };
}
