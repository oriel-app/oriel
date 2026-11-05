// The outside tools a person connected (OA-72), each with a token shown once
// and kept only as its hash: what an MCP request proves who it is with. A
// tool is who the person named when they connected it, never what the tool
// says of itself; it reads, reads and acts, or speaks for the person too,
// and the person can revoke it. Its names are unique among the tools not
// revoked, so every record's name is one tool.
// Kept in memory for the spike: the OA-72 story keeps them in the database.
import { createHash, randomBytes } from "node:crypto";
import { type Call, type Instant, toolName, type Ulid } from "@oriel/core";

// Read only: every read, and no action. Read and act: Oriel's direct
// actions too, each with its Undo; never a person's (decision 0024). Speak:
// as act, and its words in a thread start a turn as the person's would,
// under its name, rather than wait for the person to send them on (OA-75).
export type ToolMode = "read" | "act" | "speak";
export const toolModes: readonly ToolMode[] = ["read", "act", "speak"];

export type ConnectedTool = {
  id: Ulid;
  name: string;
  mode: ToolMode;
  connectedAt: Instant;
  usedAt: Instant | null;
  revokedAt: Instant | null;
};

// One of Oriel's actions a tool called, as the window lists it, and what
// undoes it: null for one with no Undo, or once undone.
export type ToolCall = {
  id: Ulid;
  tool: string;
  action: string;
  input: unknown;
  at: Instant;
  undo: Call | null;
  undone: { at: Instant; by: "tool" | "user" } | null;
};

// How many calls the window keeps for each tool: its recent work.
const keptCalls = 200;

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");

export function outsideTools(deps: { now(): Instant; newId(): Ulid }) {
  const byHash = new Map<string, ConnectedTool>();
  const revoking = new Set<(id: Ulid) => void>();
  const calls: ToolCall[] = [];
  const live = () => [...byHash.values()].filter((tool) => tool.revokedAt === null);
  return {
    // A new tool and its token, which is never shown again.
    connect(name: string, mode: ToolMode): { tool: ConnectedTool; token: string } {
      const named = toolName(name);
      if (!named.ok) throw new TypeError(named.issues.map((i) => i.message).join("; "));
      const trimmed = named.value.trim();
      if (live().some((tool) => tool.name.toLowerCase() === trimmed.toLowerCase()))
        throw new TypeError(`A tool called ${trimmed} is connected already`);
      const token = `oriel_${randomBytes(32).toString("base64url")}`;
      const tool: ConnectedTool = {
        id: deps.newId(),
        name: trimmed,
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
    // Whether the tool by this name speaks for the person now.
    speaks: (name: string): boolean =>
      live().some((tool) => tool.name === name && tool.mode === "speak"),
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

    // A call a tool made, kept with its Undo, newest last.
    called(tool: string, action: string, input: unknown, undo: Call | null): ToolCall {
      const call: ToolCall = {
        id: deps.newId(),
        tool,
        action,
        input,
        at: deps.now(),
        undo,
        undone: null,
      };
      calls.push(call);
      const own = calls.filter((each) => each.tool === tool);
      if (own.length > keptCalls) calls.splice(calls.indexOf(own[0] as ToolCall), 1);
      return call;
    },
    // The calls tools made, newest first: one tool's, or every tool's.
    calls: (tool?: string): ToolCall[] =>
      calls.filter((call) => tool === undefined || call.tool === tool).toReversed(),
    // A call undone, by the tool or the person: its Undo is spent.
    undone(id: Ulid, by: "tool" | "user"): void {
      const call = calls.find((each) => each.id === id);
      if (call) call.undone = { at: deps.now(), by };
    },
  };
}
export type OutsideTools = ReturnType<typeof outsideTools>;
