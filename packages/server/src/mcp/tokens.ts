// The outside tools a person connected (OA-72), each with a token shown once
// and kept only as its hash: what an MCP request proves who it is with. A
// tool is who the person named when they connected it, never what the tool
// says of itself; it reads, or reads and acts, and the person can revoke it.
// Kept in memory for the spike: the OA-72 story keeps them in the database.
import { createHash, randomBytes } from "node:crypto";
import { type Instant, toolName, type Ulid } from "@oriel/core";

// Read only: every read, and no action. Read and act: Oriel's direct
// actions too, each with its Undo; never a person's (decision 0024).
export type ToolMode = "read" | "act";

export type ConnectedTool = {
  id: Ulid;
  name: string;
  mode: ToolMode;
  connectedAt: Instant;
  usedAt: Instant | null;
  revokedAt: Instant | null;
};

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");

export function outsideTools(deps: { now(): Instant; newId(): Ulid }) {
  const byHash = new Map<string, ConnectedTool>();
  const revoking = new Set<(id: Ulid) => void>();
  return {
    // A new tool and its token, which is never shown again.
    connect(name: string, mode: ToolMode): { tool: ConnectedTool; token: string } {
      const named = toolName(name);
      if (!named.ok) throw new TypeError(named.issues.map((i) => i.message).join("; "));
      const token = `oriel_${randomBytes(32).toString("base64url")}`;
      const tool: ConnectedTool = {
        id: deps.newId(),
        name: named.value.trim(),
        mode,
        connectedAt: deps.now(),
        usedAt: null,
        revokedAt: null,
      };
      byHash.set(hashOf(token), tool);
      return { tool, token };
    },
    // The tool a token is, or null when there's none, or it was revoked.
    who(token: string): ConnectedTool | null {
      const tool = byHash.get(hashOf(token));
      if (!tool || tool.revokedAt !== null) return null;
      tool.usedAt = deps.now();
      return tool;
    },
    revoke(id: Ulid): boolean {
      const tool = [...byHash.values()].find((each) => each.id === id);
      if (!tool || tool.revokedAt !== null) return false;
      tool.revokedAt = deps.now();
      for (const listener of revoking) listener(tool.id);
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
    list: (): ConnectedTool[] => [...byHash.values()],
  };
}
export type OutsideTools = ReturnType<typeof outsideTools>;
