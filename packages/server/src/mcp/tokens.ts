// A token is kept only as its hash and shown once. A tool is who the person named when they connected it, never what it says of itself.
import { createHash, randomBytes } from "node:crypto";
import { type Instant, toolName, type Ulid } from "@oriel/core";
import type { OutsideToolStore, StoredTool } from "@oriel/db";

export type ToolMode = "read" | "act";

export type ConnectedTool = StoredTool;

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
    // A refresh token is never a bearer.
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
    revoke(id: Ulid): boolean {
      if (!store.revoke(workspaceId, id, deps.now())) return false;
      for (const listener of revoking) listener(id);
      return true;
    },
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
