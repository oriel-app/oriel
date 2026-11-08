// Jira through Atlassian's MCP server (OA-276): the parser on each tool's
// answer, from `fixtures/jira-mcp/`'s recorded calls, and its failing closed
// on an answer it can't read. No server runs: the recordings answer.
import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  IndexRecord,
  OpenVia,
  ThroughServer,
  ToolAnswer,
  ToolCaller,
  ToOpen,
} from "@oriel/core";
import { atlassianServer, atlassianTransport, searchBody, ServerUnreadable } from "./atlassian.ts";
import { loadCalls, replayCalls } from "./calls-cassette.ts";
import { openJira } from "./open-connection.ts";

const synced = loadCalls("sync.json");

const connection: ToOpen = {
  id: "01JRECORDING00000000000000" as ToOpen["id"],
  number: 1,
  prefix: "jira",
  identity: "",
  options: {},
};

const through = (read: ToolCaller): ThroughServer => ({
  known: atlassianServer,
  found: {
    name: "atlassian",
    status: "connected",
    reports: null,
    url: "https://mcp.atlassian.com/v2/mcp",
    command: null,
    tools: [...atlassianServer.reads, ...atlassianServer.writes],
  },
  read,
  write: async () => {
    throw new Error("nothing writes here");
  },
});

const via = (read: ToolCaller): OpenVia => ({
  log: () => {},
  now: () => "2026-11-07T00:00:00.000Z" as never,
  server: through(read),
});

const listAll = async (read: ToolCaller) => {
  const opened = await openJira(connection, via(read));
  const records: IndexRecord[] = [];
  for await (const page of opened.source.sync(null)) records.push(...page.records);
  return { opened, records };
};

// One recorded answer changed: the one to `tool`.
const altered = (tool: string, change: (answer: ToolAnswer) => ToolAnswer): ToolCaller => {
  const replay = replayCalls(synced.calls);
  return async (call) => {
    const answer = await replay(call);
    return call.tool === tool ? change(answer) : answer;
  };
};

test("a search that says more remain with no way to them fails closed, as Atlassian's has done", () => {
  // As the server's search has answered: five issues, the rest unreachable.
  const capped = {
    issues: {
      totalCount: 85,
      nodes: [1, 2, 3, 4, 5],
      remainingCount: 80,
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
  assert.throws(() => searchBody(capped), ServerUnreadable);
  assert.throws(() => searchBody({ issues: [], isLast: false }), ServerUnreadable);
  assert.throws(() => searchBody({ results: [] }), ServerUnreadable);
  // A page that doesn't say whether more remain, or an empty cursor.
  assert.throws(() => searchBody({ issues: { nodes: [], totalCount: 85 } }), ServerUnreadable);
  assert.throws(
    () => searchBody({ issues: { nodes: [1], pageInfo: { hasNextPage: true, endCursor: "" } } }),
    ServerUnreadable,
  );
  assert.throws(() => searchBody({ issues: [1], nextPageToken: "" }), ServerUnreadable);
});

test("a listed issue in a shape it can't read stops the sync, where REST's skips it", async () => {
  const broken = altered("searchJiraIssuesUsingJql", (answer) => {
    const text = (answer.content[0] as { text: string }).text;
    const body = JSON.parse(text) as { issues: { nodes: { fields: Record<string, unknown> }[] } };
    const first = body.issues.nodes[0];
    if (first) delete first.fields.status;
    return { content: [{ type: "text", text: JSON.stringify(body) }] };
  });
  await assert.rejects(listAll(broken), ServerUnreadable);
});

test("the read side refuses a write before anything is sent", async () => {
  let called = 0;
  const transport = atlassianTransport({
    cloudId: "c",
    read: async () => {
      called += 1;
      return { content: [] };
    },
  });
  await assert.rejects(
    transport({ method: "PUT", path: "/rest/api/3/issue/SYN-2", body: { fields: {} } }),
  );
  assert.equal(called, 0);
});

const [projectPick] = atlassianServer.picks ?? [];

test("the project picker reads a server's list as text it can show, and no more of it than fits", async () => {
  const values = [
    { key: "SYN", name: "x".repeat(5000), insight: { totalIssueCount: "lots" } },
    { key: "not a key", name: "Dropped" },
    { name: "No key" },
    ...Array.from({ length: 250 }, (_, i) => ({ key: `P${i}`, name: `Project ${i}` })),
  ];
  const many = altered("listJiraProjects", () => ({
    content: [{ type: "text", text: JSON.stringify({ values }) }],
  }));
  const listed = await projectPick?.list(many, "", connection);
  assert.equal(listed?.more, true);
  assert.equal(listed?.choices.length, 200);
  assert.equal(listed?.choices[0]?.name.length, 200);
  assert.equal(listed?.choices[0]?.count, null);
  assert.ok(!listed?.choices.some((each) => each.name === "Dropped" || each.name === "No key"));
  const broken = altered("listJiraProjects", () => ({ content: [{ type: "text", text: "{}" }] }));
  await assert.rejects(
    projectPick?.list(broken, "", connection) ?? Promise.resolve(),
    ServerUnreadable,
  );
});
