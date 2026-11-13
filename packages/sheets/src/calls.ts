// Recorded by `scripts/record-source-mcp.ts sheets` from the server's fixture mode.
import { readFileSync } from "node:fs";
import { type CallsFile, parseCalls } from "@oriel/core";

export const callsDir = new URL("../../../fixtures/sheets-mcp/", import.meta.url);

export const loadCalls = (name: string, dir: URL = callsDir): CallsFile =>
  parseCalls(readFileSync(new URL(name, dir), "utf8"), name);
