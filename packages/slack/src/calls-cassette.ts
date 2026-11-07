// Recorded calls of Slack's MCP server's tools, and their answers, which
// tests replay in place of the server (OA-277): `fixtures/slack-mcp/`,
// recorded by `scripts/record-source-mcp.ts slack` from the stand-in until
// Slack's own server is recorded. Each file says which it came from.
import { readFileSync } from "node:fs";
import { type CallsFile, parseCalls } from "@oriel/core";

export const callsDir = new URL("../../../fixtures/slack-mcp/", import.meta.url);

// One of `fixtures/slack-mcp/`, checked.
export const loadCalls = (name: string, dir: URL = callsDir): CallsFile =>
  parseCalls(readFileSync(new URL(name, dir), "utf8"), name);
