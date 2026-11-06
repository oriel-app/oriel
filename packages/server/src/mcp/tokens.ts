// The outside tools a person connected (decision 0058), each proving who it
// is with a token Oriel keeps only as its hash: for now, one pasted into the
// tool's config, shown once; OAuth's, with the consent in Oriel's window, is
// OA-72's. A tool is who the person named when they connected it, never what
// the tool says of itself; it reads, or reads and acts, and the person can
// revoke it.
import { createHash, randomBytes } from "node:crypto";
import { type Instant, toolName, type Ulid } from "@oriel/core";
import type { OutsideToolStore, StoredTool } from "@oriel/db";

// Read only: every read, and no action. Read and act: Oriel's direct
// actions open to tools too, each with its Undo; never a person's
// (decision 0024).
export type ToolMode = "read" | "act";

export type ConnectedTool = StoredTool;

// How stale a tool's "last used" may get before a request writes it again.
const usedEvery = 60 * 1000;

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");
const minted = (kind: string) => `oriel_${kind}_${randomBytes(32).toString("base64url")}`;

export function outsideTools(deps: {
  store: OutsideToolStore;
  workspaceId: Ulid;
  now(): Instant;
  newId(): Ulid;
}) {
  const { store, workspaceId } = deps;
  const revoking = new Set<(id: Ulid) => void>();
  return {
    // A new tool and its token, which is never shown again. A name another
    // live tool has is refused.
    connect(name: string, mode: ToolMode): { tool: ConnectedTool; token: string } {
      const checked = toolName(name);
      if (!checked.ok) throw new TypeError(checked.issues.map((i) => i.message).join("; "));
      const token = minted("pt");
      const tool: ConnectedTool = {
        id: deps.newId(),
        name: checked.value.trim(),
        mode,
        says: null,
        client: null,
        connectedAt: deps.now(),
        usedAt: null,
        revokedAt: null,
      };
      store.connect(workspaceId, tool, [{ hash: hashOf(token), kind: "pasted", expiresAt: null }]);
      return { tool, token };
    },
    // The tool a bearer token is, or null when there's none, it expired, or
    // it was revoked. A refresh token is never a bearer.
    who(token: string): ConnectedTool | null {
      const found = store.byHash(workspaceId, hashOf(token));
      if (!found || found.kind === "refresh") return null;
      const now = deps.now();
      if (found.expiresAt !== null && found.expiresAt <= now) return null;
      const { tool } = found;
      if (tool.usedAt === null || Date.parse(now) - Date.parse(tool.usedAt) > usedEvery) {
        store.used(workspaceId, tool.id, now);
        tool.usedAt = now;
      }
      return tool;
    },
    // Refused from its next request, and whatever it has open ends.
    revoke(id: Ulid): boolean {
      if (!store.revoke(workspaceId, id, deps.now())) return false;
      for (const listener of revoking) listener(id);
      return true;
    },
    // Calls `listener` with each tool revoked, until the call it gives back
    // stops it: what it has open ends then.
    onRevoke(listener: (id: Ulid) => void): () => void {
      revoking.add(listener);
      return () => {
        revoking.delete(listener);
      };
    },
    list: (): ConnectedTool[] => store.list(workspaceId),
  };
}
export type OutsideTools = ReturnType<typeof outsideTools>;
