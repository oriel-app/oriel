// Stand-in source servers for dev only (OA-276, OA-277):
// `ORIEL_DEV_STANDINS=atlassian,slack pnpm dev` gives every process of the
// person's agent Oriel starts one more MCP server for each,
// packages/standin-mcp's stand-in for Atlassian's or Slack's, on its command
// line only, never in the person's configuration, and has the connector's
// entry for the real server know it at that command in place of its
// address. The desktop app never names one.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DevServer } from "@oriel/agent";
import type { SourceServer } from "@oriel/core";
import { knownServers } from "@oriel/sources";

const main = fileURLToPath(new URL("../../standin-mcp/src/main.ts", import.meta.url));

// Each stand-in, by its name on the command line: the real server's entry
// it stands in for, by the name that entry reports.
const standIns: Record<string, string> = {
  atlassian: "atlassian-rovo-mcp-server",
  slack: "Slack MCP",
};

export function devStandIns(asked: string | undefined): {
  dev: DevServer[];
  known: { kind: string; server: SourceServer }[];
} | null {
  const names = (asked ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (!names.length) return null;
  const unknown = names.find((name) => !Object.hasOwn(standIns, name));
  if (unknown) throw new Error(`ORIEL_DEV_STANDINS: no stand-in called ${unknown}`);
  // One journal for this start, which every process's stand-in shares, so
  // a sync reads what a replay wrote.
  const journal = (name: string) => join(tmpdir(), `oriel-standin-${name}-${process.pid}.jsonl`);
  const args = (name: string) => [main, name, "--journal", journal(name)];
  const dev = names.map((name) => ({ name: `${name}-standin`, command: "node", args: args(name) }));
  const known = knownServers.map((each) => {
    const name = names.find((one) => standIns[one] === each.server.reports);
    if (!name) return each;
    return {
      kind: each.kind,
      server: { ...each.server, at: { command: ["node", ...args(name)].join(" ") } },
    };
  });
  return { dev, known };
}
