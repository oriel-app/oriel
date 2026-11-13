// Dev only: each stand-in is on the agent's command line only, never in the person's configuration, and the desktop app
// never names one.
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

// Every process of one start shares that file, so a sync reads what a replay wrote.
const standIns: Record<string, { reports: string; args: (kept: string) => string[] }> = {
  atlassian: {
    reports: "atlassian-mcp-server",
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
  // A stand-in that matches no known server would leave the real one in
  // its place, and a dev world meant to write to a stand-in would write to
  // the person's real source: refuse to start instead.
  const unmatched = names.find(
    (name) => !knownServers.some((each) => each.server.reports === standIns[name]?.reports),
  );
  if (unmatched)
    throw new Error(`ORIEL_DEV_STANDINS: the ${unmatched} stand-in matches no server Oriel knows`);
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
