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

test("a server that reports a known name and offers every read tool serves its kind", () => {
  const [match, ...rest] = recognize([found()], known);
  assert.equal(rest.length, 0);
  assert.equal(match?.kind, "jira");
  assert.equal(match?.known, tracker);
  assert.equal(match?.found.name, "work-tracker");
});

test("a server at the known address counts whatever it reports, and one elsewhere doesn't", () => {
  const at = found({ reports: "something-else", url: "https://mcp.example.invalid/v1/" });
  assert.equal(recognize([at], known).length, 1);
  const elsewhere = found({ url: "https://other.example.invalid/v1" });
  assert.equal(recognize([elsewhere], known).length, 0, "the name alone doesn't vouch for it");
});

test("a server missing a read tool isn't recognised, though it misses no write", () => {
  assert.equal(recognize([found({ tools: ["search_issues", "create_issue"] })], known).length, 0);
  assert.equal(recognize([found({ tools: ["search_issues", "get_issue"] })], known).length, 1);
});

test("a server that needs signing in lists no tools, so it isn't recognised yet", () => {
  assert.equal(recognize([found({ status: "needs-auth", tools: [] })], known).length, 0);
});

test("a server Oriel doesn't know is never offered, whatever its tools", () => {
  const stranger = found({ name: "shell", reports: "my-shell", tools: tracker.reads });
  assert.deepEqual(recognize([stranger], known), []);
  assert.deepEqual(recognize([found()], []), []);
});

test("a command-line entry matches the command the agent runs", () => {
  const local: SourceServer = {
    ...tracker,
    reports: "local-tracker",
    at: { command: "tracker-mcp" },
  };
  const entries = [{ kind: "jira", server: local }];
  assert.equal(recognize([found({ reports: null, command: "tracker-mcp" })], entries).length, 1);
  assert.equal(
    recognize([found({ reports: null, command: "tracker-mcp --x" })], entries).length,
    0,
  );
});
