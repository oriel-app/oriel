// The outside tools a person connected (OA-72), each proving who it is with
// a token Oriel keeps only as its hash: one pasted into the tool's config,
// shown once, or an OAuth access token the tool signed in for, in Oriel's
// window, with a refresh token that renews it. A tool is who the person
// named when they connected it, never what the tool says of itself; it
// reads, or reads and acts, and the person can revoke it.
import { createHash, randomBytes } from "node:crypto";
import { type Instant, instant, toolName, type Ulid } from "@oriel/core";
import type { OutsideToolStore, StoredTool, ToolClient } from "@oriel/db";

// Read only: every read, and no action. Read and act: Oriel's direct
// actions too, each with its Undo; never a person's (decision 0024).
export type ToolMode = "read" | "act";

export type ConnectedTool = StoredTool;

// How long an OAuth access token lasts, and its refresh token.
export const accessLife = 60 * 60 * 1000;
export const refreshLife = 30 * 24 * 60 * 60 * 1000;
// How stale a tool's "last used" may get before a request writes it again.
const usedEvery = 60 * 1000;

export const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");
const minted = (kind: string) => `oriel_${kind}_${randomBytes(32).toString("base64url")}`;

export function outsideTools(deps: {
  store: OutsideToolStore;
  workspaceId: Ulid;
  now(): Instant;
  newId(): Ulid;
}) {
  const { store, workspaceId } = deps;
  const revoking = new Set<(id: Ulid) => void>();
  const later = (ms: number) => instant(new Date(Date.parse(deps.now()) + ms));
  const named = (name: string) => {
    const checked = toolName(name);
    if (!checked.ok) throw new TypeError(checked.issues.map((i) => i.message).join("; "));
    return checked.value.trim();
  };
  const fresh = () => {
    const access = minted("at");
    const refresh = minted("rt");
    return {
      access,
      refresh,
      tokens: [
        { hash: hashOf(access), kind: "access" as const, expiresAt: later(accessLife) },
        { hash: hashOf(refresh), kind: "refresh" as const, expiresAt: later(refreshLife) },
      ],
    };
  };
  return {
    // A new tool and its token, which is never shown again.
    connect(name: string, mode: ToolMode): { tool: ConnectedTool; token: string } {
      const token = minted("pt");
      const tool: ConnectedTool = {
        id: deps.newId(),
        name: named(name),
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
    // A tool the person let in from Oriel's window, once it signed in with
    // OAuth: its first access and refresh tokens.
    grant(
      name: string,
      mode: ToolMode,
      says: string | null,
      client: ToolClient,
    ): { tool: ConnectedTool; access: string; refresh: string } {
      const tool: ConnectedTool = {
        id: deps.newId(),
        name: named(name),
        mode,
        says,
        client,
        connectedAt: deps.now(),
        usedAt: null,
        revokedAt: null,
      };
      const { access, refresh, tokens } = fresh();
      store.connect(workspaceId, tool, tokens);
      return { tool, access, refresh };
    },
    // New tokens for a refresh token the client it was given to still holds,
    // which can't be spent again; null for one spent, expired or revoked.
    refresh(token: string, clientId: string): { access: string; refresh: string } | null {
      const found = store.byHash(workspaceId, hashOf(token));
      if (!found || found.kind !== "refresh" || found.tool.client?.id !== clientId) return null;
      if (found.expiresAt !== null && found.expiresAt <= deps.now()) return null;
      const next = fresh();
      if (!store.renew(workspaceId, found.tool.id, hashOf(token), next.tokens)) return null;
      return { access: next.access, refresh: next.refresh };
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
