#!/usr/bin/env node
// A stand-in MCP server, by the name of the one it stands in for:
// `node packages/standin-mcp/src/main.ts atlassian`. For dev and tests only.
import { atlassianInfo, atlassianStandIn } from "./atlassian.ts";
import { serveLines, standInServer } from "./mcp.ts";

const standIns = {
  atlassian: () => standInServer(atlassianInfo, atlassianStandIn()),
};

const name = process.argv[2] ?? "";
if (!Object.hasOwn(standIns, name)) {
  process.stderr.write(`Usage: main.ts <${Object.keys(standIns).join("|")}>\n`);
  process.exitCode = 2;
} else {
  await serveLines(standIns[name as keyof typeof standIns](), process.stdin, process.stdout);
}
