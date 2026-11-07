// Recorded calls of Atlassian's server's tools, and their answers, which
// tests replay in place of the server (OA-276): `fixtures/jira-mcp/`,
// recorded by `scripts/record-source-mcp.ts jira` from the stand-in until
// Atlassian's own server is recorded. Each file says which it came from.
import { readFileSync } from "node:fs";
import { type CallsFile, parseCalls } from "@oriel/core";

export { type CallsFile, type RecordedCall, recordingCalls, replayCalls } from "@oriel/core";

export const callsDir = new URL("../../../fixtures/jira-mcp/", import.meta.url);

// One of `fixtures/jira-mcp/`, checked.
export const loadCalls = (name: string, dir: URL = callsDir): CallsFile =>
  parseCalls(readFileSync(new URL(name, dir), "utf8"), name);
