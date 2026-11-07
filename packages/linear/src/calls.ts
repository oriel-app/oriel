// Recorded calls of Linear's MCP server's tools, and their answers, which
// tests replay in place of the server (OA-278): `fixtures/linear-mcp/`,
// recorded by `scripts/record-source-mcp.ts linear` from the stand-in until
// Linear's own server is recorded. Each file says which it came from.
import { readFileSync } from "node:fs";
import { type CallsFile, parseCalls } from "@oriel/core";

export const callsDir = new URL("../../../fixtures/linear-mcp/", import.meta.url);

// One of `fixtures/linear-mcp/`, checked.
export const loadCalls = (name: string, dir: URL = callsDir): CallsFile =>
  parseCalls(readFileSync(new URL(name, dir), "utf8"), name);
