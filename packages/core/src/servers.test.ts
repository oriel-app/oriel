import assert from "node:assert/strict";
import { test } from "node:test";
import { type FoundServer, recognize, type SourceServer } from "./servers.ts";

const tracker: SourceServer = {
  name: "Example's tracker server",
  reports: "example-tracker",
  at: { url: "https://mcp.example.invalid/v1" },
  reads: ["search_issues", "get_issue"],
  writes: ["create_issue"],
  instructions: "https://example.invalid/docs/mcp",
};
const known = [{ kind: "jira", server: tracker }];

const found = (over: Partial<FoundServer> = {}): FoundServer => ({
  name: "work-tracker",
  status: "connected",
  reports: "example-tracker",
  url: null,
  command: null,
  tools: ["search_issues", "get_issue", "create_issue", "delete_everything"],
  ...over,
});

test("a server at the known address counts whatever it reports, and one elsewhere doesn't", () => {
  const at = found({ reports: "something-else", url: "https://mcp.example.invalid/v1/" });
  assert.equal(recognize([at], known).length, 1);
  const elsewhere = found({ url: "https://other.example.invalid/v1" });
  assert.equal(recognize([elsewhere], known).length, 0, "the name alone doesn't vouch for it");
  const local = found({ command: "node fake-tracker.js" });
  assert.equal(recognize([local], known).length, 0, "nor does it for a local server");
});
