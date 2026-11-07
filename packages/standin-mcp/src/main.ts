#!/usr/bin/env node
// A stand-in MCP server, by the name of the one it stands in for:
// `node packages/standin-mcp/src/main.ts <atlassian|slack|linear> [--journal <file>]`. For
// dev and tests only. With a journal, every process given the same one
// shares its writes (journal.ts).
import { parseArgs } from "node:util";
import { atlassianInfo, atlassianStandIn } from "@oriel/jira/standin";
import { linearInfo, linearStandIn } from "@oriel/linear/standin";
import { slackInfo, slackStandIn } from "@oriel/slack/standin";
import { journaled } from "./journal.ts";
import { serveLines, standInServer } from "./mcp.ts";

const standIns = {
  atlassian: { info: atlassianInfo, tools: atlassianStandIn },
  slack: { info: slackInfo, tools: slackStandIn },
  linear: { info: linearInfo, tools: () => linearStandIn() },
};

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { journal: { type: "string" } },
});
const name = positionals[0] ?? "";
if (!Object.hasOwn(standIns, name)) {
  process.stderr.write(`Usage: main.ts <${Object.keys(standIns).join("|")}> [--journal <file>]\n`);
  process.exitCode = 2;
} else {
  const { info, tools } = standIns[name as keyof typeof standIns];
  const served = values.journal ? journaled(tools(), values.journal) : tools();
  await serveLines(standInServer(info, served), process.stdin, process.stdout);
}
