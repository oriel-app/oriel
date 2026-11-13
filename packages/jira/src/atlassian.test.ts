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
import {
  atlassianServer,
  atlassianTransport,
  bodyOf,
  searchBody,
  ServerUnreadable,
} from "./atlassian.ts";
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

const altered = (tool: string, change: (answer: ToolAnswer) => ToolAnswer): ToolCaller => {
  const replay = replayCalls(synced.calls);
  return async (call) =>
    call.tool === tool ? change(await replay(call).catch(() => ({ content: [] }))) : replay(call);
};

test("what Atlassian's own server answered, recorded, syncs SYN whole, with each issue's fields", async () => {
  const real = loadCalls("real-sync.json");
  const opened = await openJira(
    { ...connection, options: { project: "SYN" } },
    via(replayCalls(real.calls)),
  );
  const records: IndexRecord[] = [];
  for await (const page of opened.source.sync(null)) records.push(...page.records);
  assert.ok(records.length >= 100, `${records.length} issues`);
  assert.ok(records.some((record) => record.facets?.container));
  assert.ok(records.some((record) => typeof record.facets?.estimate === "number"));
});

test("a search that says more remain with no way to them fails closed", () => {
  assert.throws(() => searchBody({ issues: [], isLast: false }), ServerUnreadable);
  assert.throws(() => searchBody({ results: [] }), ServerUnreadable);
  assert.throws(() => searchBody({ issues: [1], nextPageToken: "" }), ServerUnreadable);
  // The search's structured content, which Claude Code doesn't pass on, is
  // another shape: never read for the text's.
  assert.throws(
    () => searchBody({ issues: { nodes: [], pageInfo: { hasNextPage: false } } }),
    ServerUnreadable,
  );
});

test("an answer without its data, or a custom field without its ID, stops the sync", async () => {
  const answer = (value: unknown): ToolAnswer => ({
    content: [{ type: "text", text: JSON.stringify(value) }],
  });
  assert.throws(() => bodyOf("t", answer({ issues: [] })), ServerUnreadable);
  assert.throws(
    () => bodyOf("t", { content: [{ type: "text", text: "Done." }] }),
    ServerUnreadable,
  );
  assert.equal(
    bodyOf("t", {
      ...answer({ error: true, message: "Issue not found", statusCode: 404 }),
      isError: true,
    }).status,
    404,
  );
  const unlabelled = altered("searchJiraIssuesUsingJql", (given) => {
    const body = JSON.parse((given.content[0] as { text: string }).text) as {
      data: { issues: { fields: Record<string, unknown> }[] };
    };
    const first = body.data.issues[0];
    if (first) first.fields.customFields = { "Story Points": { value: 3 } };
    return answer(body);
  });
  await assert.rejects(listAll(unlabelled), ServerUnreadable);
});

test("a listed issue in a shape it can't read stops the sync, where REST's skips it", async () => {
  const broken = altered("searchJiraIssuesUsingJql", (answer) => {
    const text = (answer.content[0] as { text: string }).text;
    const body = JSON.parse(text) as { data: { issues: { fields: Record<string, unknown> }[] } };
    const first = body.data.issues[0];
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
  const many = altered("executeRead", () => ({
    content: [{ type: "text", text: JSON.stringify({ data: { values } }) }],
  }));
  const listed = await projectPick?.list(many, "", connection);
  assert.equal(listed?.more, true);
  assert.equal(listed?.choices.length, 200);
  assert.equal(listed?.choices[0]?.name.length, 200);
  assert.equal(listed?.choices[0]?.count, null);
  assert.ok(!listed?.choices.some((each) => each.name === "Dropped" || each.name === "No key"));
  const broken = altered("executeRead", () => ({
    content: [{ type: "text", text: '{"data":{}}' }],
  }));
  await assert.rejects(
    projectPick?.list(broken, "", connection) ?? Promise.resolve(),
    ServerUnreadable,
  );
});
