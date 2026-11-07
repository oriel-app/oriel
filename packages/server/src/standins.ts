// Stand-in source servers for dev only (OA-276, OA-277, OA-278, OA-279):
// `ORIEL_DEV_STANDINS=atlassian,slack,linear,sheets pnpm dev` gives every
// process of the person's agent Oriel starts one more MCP server for each,
// packages/standin-mcp's stand-in for Atlassian's, Slack's or Linear's, or
// packages/sheets-mcp in its fixture mode, on a copy of its shipped
// fixture, on its command line only, never in the person's configuration,
// and has the connector's entry for the real server know it at that
// command in place of its own. The desktop app never names one.
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DevServer } from "@oriel/agent";
import type { SourceServer } from "@oriel/core";
import { knownServers } from "@oriel/sources";

const main = fileURLToPath(new URL("../../standin-mcp/src/main.ts", import.meta.url));
const sheetsMain = fileURLToPath(new URL("../../sheets-mcp/src/main.ts", import.meta.url));
const backlog = fileURLToPath(new URL("../../sheets-mcp/fixture/backlog.json", import.meta.url));

// Each stand-in, by its name on the command line: the real server's entry
// it stands in for, by the name that entry reports, and its arguments to
// `node`, given the file this start keeps its writes in. Every process of
// one start shares that file, so a sync reads what a replay wrote.
const standIns: Record<string, { reports: string; args: (kept: string) => string[] }> = {
  atlassian: {
    reports: "atlassian-rovo-mcp-server",
    args: (kept) => [main, "atlassian", "--journal", kept],
  },
  slack: { reports: "Slack MCP", args: (kept) => [main, "slack", "--journal", kept] },
  linear: { reports: "linear", args: (kept) => [main, "linear", "--journal", kept] },
  sheets: { reports: "sheets-mcp", args: (kept) => [sheetsMain, "--fixture", kept, "--shared"] },
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
  // One file for this start, which every process's stand-in shares: a
  // journal, or a copy of sheets-mcp's fixture.
  const kept = (name: string) => {
    if (name !== "sheets") return join(tmpdir(), `oriel-standin-${name}-${process.pid}.jsonl`);
    // In a folder of its own, which no one else can have made first.
    const copy = join(mkdtempSync(join(tmpdir(), "oriel-standin-sheets-")), "backlog.json");
    copyFileSync(backlog, copy);
    return copy;
  };
  const files = new Map(names.map((name) => [name, kept(name)]));
  const args = (name: string) => standIns[name]?.args(files.get(name) ?? "") ?? [];
  const dev = names.map((name) => ({ name: `${name}-standin`, command: "node", args: args(name) }));
  const known = knownServers.map((each) => {
    const name = names.find((one) => standIns[one]?.reports === each.server.reports);
    if (!name) return each;
    return {
      kind: each.kind,
      server: { ...each.server, at: { command: ["node", ...args(name)].join(" ") } },
    };
  });
  return { dev, known };
}
