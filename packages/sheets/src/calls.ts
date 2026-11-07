// Recorded calls of packages/sheets-mcp's tools, and their answers, which
// tests replay in place of the server (OA-279): `fixtures/sheets-mcp/`,
// recorded by `scripts/record-source-mcp.ts sheets` from the server's own
// fixture mode, until it's recorded signed in to our test account. Each file
// says which it came from.
import { readFileSync } from "node:fs";
import { type CallsFile, parseCalls } from "@oriel/core";

export const callsDir = new URL("../../../fixtures/sheets-mcp/", import.meta.url);

// One of `fixtures/sheets-mcp/`, checked.
export const loadCalls = (name: string, dir: URL = callsDir): CallsFile =>
  parseCalls(readFileSync(new URL(name, dir), "utf8"), name);
