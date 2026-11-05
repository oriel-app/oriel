// The outside tools a person connected (OA-72), each with a token shown once
// and kept only as its hash: what an MCP request proves who it is with. A
// tool is who the person named when they connected it, never what the tool
// says of itself; it reads, or reads and acts, and the person can revoke it.
// A person may trust one that acts (the mcp-agents spike): its words then
// start a turn in the workstreams they named, as theirs would, within caps
// of its own, instead of waiting for their Send.
// Kept in memory for the spike: the OA-72 story keeps them in the database.
import { createHash, randomBytes } from "node:crypto";
import { type Instant, toolName, type Ulid } from "@oriel/core";

// Read only: every read, and no action. Read and act: Oriel's direct
// actions too, each with its Undo; never a person's (decision 0024).
export type ToolMode = "read" | "act";

// What a person trusts a tool with: the workstreams where its words start a
// turn, and how many turns, and tokens of the person's model, it may spend
// in any 24 hours. Past them, or elsewhere, its words are held, as an
// untrusted tool's are.
export type Trust = {
  workstreams: readonly Ulid[];
  turnsPerDay: number;
  tokensPerDay: number;
};

export type ConnectedTool = {
  id: Ulid;
  name: string;
  mode: ToolMode;
  trust: Trust | null;
  connectedAt: Instant;
  usedAt: Instant | null;
  revokedAt: Instant | null;
};

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");
const day = 24 * 60 * 60 * 1000;

export function outsideTools(deps: { now(): Instant; newId(): Ulid }) {
  const byHash = new Map<string, ConnectedTool>();
  const revoking = new Set<(tool: ConnectedTool) => void>();
  // Each tool's turns: when each started, and the tokens it spent once it
  // ended. The story derives these from the threads' chats instead.
  const turns = new Map<Ulid, { at: number; tokens: number }[]>();
  const live = () => [...byHash.values()].filter((tool) => tool.revokedAt === null);
  const named = (name: string) => live().find((tool) => tool.name === name) ?? null;
  const spent = (tool: ConnectedTool) => {
    const now = Date.parse(deps.now());
    const recent = (turns.get(tool.id) ?? []).filter((turn) => now - turn.at < day);
    return { turns: recent.length, tokens: recent.reduce((sum, turn) => sum + turn.tokens, 0) };
  };
  return {
    // A new tool and its token, which is never shown again. Its name is
    // what the window calls it, so no two connected tools share one.
    connect(
      name: string,
      mode: ToolMode,
      trust: Trust | null = null,
    ): { tool: ConnectedTool; token: string } {
      const checked = toolName(name);
      if (!checked.ok) throw new TypeError(checked.issues.map((i) => i.message).join("; "));
      if (named(checked.value.trim())) throw new TypeError("a connected tool has that name");
      if (trust && mode !== "act") throw new TypeError("only a tool that acts can be trusted");
      const token = `oriel_${randomBytes(32).toString("base64url")}`;
      const tool: ConnectedTool = {
        id: deps.newId(),
        name: checked.value.trim(),
        mode,
        trust,
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
    // Why the tool called `name` may not start a turn in `workstream` now,
    // or null when it may: the person trusts it there, and it is within
    // its caps.
    whyHeld(name: string, workstream: Ulid): string | null {
      const tool = named(name);
      if (!tool?.trust) return "the user hasn't trusted you to start turns, so they send it on";
      if (!tool.trust.workstreams.includes(workstream))
        return "this workstream is outside the ones the user trusts you with";
      const { turns: started, tokens } = spent(tool);
      if (started >= tool.trust.turnsPerDay)
        return `you've started ${started} turns today, all the user allows`;
      if (tokens >= tool.trust.tokensPerDay)
        return `your turns spent ${tokens.toLocaleString("en-US")} tokens today, all the user allows`;
      return null;
    },
    // The workstreams a trusted tool's turns may change, or null for one
    // that isn't trusted.
    scope: (name: string): readonly Ulid[] | null => named(name)?.trust?.workstreams ?? null,
    // A turn the tool called `name` started, and, once it ends, what it
    // spent: `ended` is called with its tokens.
    started(name: string): (tokens: number) => void {
      const tool = named(name);
      if (!tool) return () => {};
      const turn = { at: Date.parse(deps.now()), tokens: 0 };
      turns.set(tool.id, [...(turns.get(tool.id) ?? []), turn]);
      return (tokens) => {
        turn.tokens = tokens;
      };
    },
    spent,
    revoke(id: Ulid): boolean {
      const tool = [...byHash.values()].find((each) => each.id === id);
      if (!tool || tool.revokedAt !== null) return false;
      tool.revokedAt = deps.now();
      for (const listener of revoking) listener(tool);
      return true;
    },
    // Calls `listener` with each tool revoked, until the call it gives back
    // stops it: what it has open, and turns it started, end then.
    onRevoke(listener: (tool: ConnectedTool) => void): () => void {
      revoking.add(listener);
      return () => {
        revoking.delete(listener);
      };
    },
    list: (): ConnectedTool[] => [...byHash.values()],
  };
}
export type OutsideTools = ReturnType<typeof outsideTools>;
