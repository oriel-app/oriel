import { readFileSync } from "node:fs";
import { type CallsFile, parseCalls } from "@oriel/core";

export const callsDir = new URL("../../../fixtures/linear-mcp/", import.meta.url);

export const loadCalls = (name: string, dir: URL = callsDir): CallsFile =>
  parseCalls(readFileSync(new URL(name, dir), "utf8"), name);
