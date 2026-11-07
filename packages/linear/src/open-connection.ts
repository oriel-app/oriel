// A Linear connection, opened (decision 0049): only through Linear's own MCP
// server (decision 0059), with no API key or token of Oriel's. It reads one
// team, the one its options name by key, else the first the server lists;
// its namespace's context and its writer go by what its last sync found of
// that team.
import {
  type Instant,
  type Opened,
  type OpenVia,
  OptionsUnfit,
  ServerUnreadable,
  SourceRefused,
  type ThroughServer,
  type ToolCaller,
  type ToOpen,
  issueAttrs,
} from "@oriel/core";
import type { TeamWorld } from "./items.ts";
import { type LinearTeam, linearReads } from "./linear-mcp.ts";
import { linearSource } from "./source.ts";

// What a Linear connection's writer is built from, by its line in
// packages/changeset/src/writers.ts: its team, and the server's reads and
// writes, each from its own process.
export type LinearWrites = {
  team: LinearTeam;
  read: ToolCaller;
  write: ToolCaller;
  prefix?: string;
};

// What the namespace takes: the team as the last sync found it, and now,
// which tells the cycle under way.
export type LinearContext = { world: TeamWorld; now: Instant };
export type LinearScope = { team: string };
export type OpenedLinear = Opened<LinearContext | undefined, LinearScope, LinearWrites>;

// The team a connection reads, from its options.
export const linearTeam = (options: Readonly<Record<string, unknown>>): string =>
  typeof options.team === "string" ? options.team : "";

export async function openLinear(connection: ToOpen, via: OpenVia): Promise<OpenedLinear> {
  if (!via.server) throw new Error("Linear turns on only through Linear's MCP server");
  return openThrough(connection, via, via.server);
}

export async function openThrough(
  connection: ToOpen,
  via: OpenVia,
  server: ThroughServer,
  frozen?: Instant,
): Promise<OpenedLinear> {
  const reads = linearReads(server.read);
  const teams = await reads.teams();
  const named = linearTeam(connection.options);
  const team = named ? teams.find((each) => each.key === named) : teams[0];
  // A team picked that it no longer lists doesn't fit its options: it
  // waits for another (decision 0051).
  if (!team && named) throw new OptionsUnfit(`${server.known.name} lists no team ${named}`);
  if (!team) throw new Error(`${server.known.name} lists no Linear team`);
  const source = linearSource({ reads, team, prefix: connection.prefix });
  return {
    source,
    attrs: issueAttrs,
    identity: team.id,
    about: `${team.key} (${team.name}), through ${server.known.name}`,
    scope: { team: team.key },
    context: () => {
      const world = source.known();
      return world ? { world, now: frozen ?? via.now() } : undefined;
    },
    writes: { team, read: server.read, write: server.write, prefix: connection.prefix },
    ...(frozen ? { frozen } : {}),
    problem: (error) => linearProblem(error, server.known.name),
  };
}

// What the person sees when Linear can't be synced through its server,
// naming it. A sync that fails this way keeps the index as it was.
export function linearProblem(error: unknown, server: string): string {
  if (error instanceof ServerUnreadable)
    return `${server} answered in a way Oriel didn't expect, so Oriel kept the window as it was.`;
  if (error instanceof SourceRefused)
    return `${server} turned Oriel away, so the window may be behind Linear. Sign in to it again in your agent.`;
  return `Oriel couldn't sync Linear through ${server}, so the window may be behind it. Try again in a moment.`;
}
