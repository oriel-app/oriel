// The outside tools a person connected (decision 0058), and their tokens,
// kept only as hashes: a token itself is shown once, or handed to the tool
// by OAuth (OA-72), and never stored. See migrations/0029_outside_tools.sql.
import type { DatabaseSync } from "node:sqlite";
import {
  type Instant,
  isInstant,
  isUlid,
  literal,
  nullable,
  object,
  refine,
  string,
  type Ulid,
  union,
} from "@oriel/core";
import { transaction } from "./open.ts";

const instant = refine(string, isInstant, "expected an instant");
const toolRow = object({
  id: refine(string, isUlid, "expected a ULID"),
  name: string,
  mode: union(literal("read"), literal("act")),
  says: nullable(string),
  client: nullable(string),
  connected_at: instant,
  used_at: nullable(instant),
  revoked_at: nullable(instant),
});

// The OAuth client a tool signed in as: the ID Oriel gave it when it
// registered, and the loopback addresses its sign-in may return to.
export type ToolClient = { id: string; redirects: string[] };

export type StoredTool = {
  id: Ulid;
  name: string;
  mode: "read" | "act";
  says: string | null;
  client: ToolClient | null;
  connectedAt: Instant;
  usedAt: Instant | null;
  revokedAt: Instant | null;
};

export type TokenKind = "pasted" | "access" | "refresh";

export type OutsideToolStore = ReturnType<typeof outsideToolStore>;

export function outsideToolStore(db: DatabaseSync) {
  const columns =
    "id, name, mode, says, client, connected_at, used_at, revoked_at from outside_tools";
  const selectAll = db.prepare(
    `select ${columns} where workspace_id = ? order by connected_at, rowid`,
  );
  const selectByHash = db.prepare(`
    select t.id, t.name, t.mode, t.says, t.client, t.connected_at, t.used_at, t.revoked_at,
      k.kind, k.expires_at
    from outside_tool_tokens k join outside_tools t on t.id = k.tool_id
    where k.workspace_id = ? and k.hash = ?`);
  const selectLive = db.prepare(
    "select 1 from outside_tools where workspace_id = ? and lower(name) = lower(?) and revoked_at is null",
  );
  const insertTool = db.prepare(`
    insert into outside_tools (id, workspace_id, name, mode, says, client, connected_at)
    values (?, ?, ?, ?, ?, ?, ?)`);
  const insertToken = db.prepare(
    "insert into outside_tool_tokens (hash, workspace_id, tool_id, kind, expires_at) values (?, ?, ?, ?, ?)",
  );
  const deleteTokens = db.prepare(
    "delete from outside_tool_tokens where workspace_id = ? and tool_id = ?",
  );
  const markUsed = db.prepare(
    "update outside_tools set used_at = ? where workspace_id = ? and id = ?",
  );
  const markRevoked = db.prepare(
    "update outside_tools set revoked_at = ? where workspace_id = ? and id = ? and revoked_at is null",
  );

  const read = (raw: unknown): StoredTool => {
    const row = toolRow(raw);
    if (!row.ok) throw new Error(`corrupt outside_tools row: ${JSON.stringify(row.issues)}`);
    const { id, name, mode, says, client, connected_at, used_at, revoked_at } = row.value;
    return {
      id,
      name,
      mode,
      says,
      client: client === null ? null : (JSON.parse(client) as ToolClient),
      connectedAt: connected_at,
      usedAt: used_at,
      revokedAt: revoked_at,
    };
  };

  return {
    list: (workspaceId: Ulid): StoredTool[] => selectAll.all(workspaceId).map(read),

    // A tool and its first tokens, at once. A name a live tool has is
    // refused, as a name is who acted in every record.
    connect(
      workspaceId: Ulid,
      tool: Omit<StoredTool, "usedAt" | "revokedAt">,
      tokens: { hash: string; kind: TokenKind; expiresAt: Instant | null }[],
    ): void {
      transaction(db, () => {
        if (selectLive.get(workspaceId, tool.name))
          throw new RangeError(`A connected tool is called ${tool.name} already.`);
        insertTool.run(
          tool.id,
          workspaceId,
          tool.name,
          tool.mode,
          tool.says,
          tool.client === null ? null : JSON.stringify(tool.client),
          tool.connectedAt,
        );
        for (const token of tokens)
          insertToken.run(token.hash, workspaceId, tool.id, token.kind, token.expiresAt);
      });
    },

    // The tool a token's hash is, and what kind of token it is; null for
    // none, or a revoked tool's.
    byHash(
      workspaceId: Ulid,
      hash: string,
    ): { tool: StoredTool; kind: TokenKind; expiresAt: Instant | null } | null {
      const raw = selectByHash.get(workspaceId, hash) as
        | (Record<string, unknown> & { kind: TokenKind; expires_at: Instant | null })
        | undefined;
      if (!raw) return null;
      const tool = read(raw);
      return tool.revokedAt === null ? { tool, kind: raw.kind, expiresAt: raw.expires_at } : null;
    },

    used(workspaceId: Ulid, id: Ulid, at: Instant): void {
      markUsed.run(at, workspaceId, id);
    },

    // Revoked from now: its tokens are gone, and its row stays.
    revoke(workspaceId: Ulid, id: Ulid, at: Instant): boolean {
      return transaction(db, () => {
        if (markRevoked.run(at, workspaceId, id).changes === 0) return false;
        deleteTokens.run(workspaceId, id);
        return true;
      });
    },
  };
}
