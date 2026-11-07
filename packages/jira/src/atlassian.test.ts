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
import {
  atlassianServer,
  atlassianTransport,
  bodyOf,
  searchBody,
  ServerUnreadable,
  siteOf,
} from "./atlassian.ts";
import { loadCalls, replayCalls } from "./calls-cassette.ts";
import { fixtureSnapshot, loadJiraFixture } from "./fixture.ts";
import { openJira, serverProblem } from "./open-connection.ts";

const fixture = loadJiraFixture();
const site = "https://oriel.atlassian.net";
const synced = loadCalls("sync.json");
const reads = loadCalls("read.json");

const connection: ToOpen = {
  id: "01JRECORDING00000000000000" as ToOpen["id"],
  number: 1,
  prefix: "jira",
  identity: "",
  options: {},
  secret: null,
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
  kept: false,
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

test("the recordings say where they came from", () => {
  assert.match(synced.recorded, /stand-in|Atlassian's Rovo MCP server/);
  assert.match(reads.recorded, /stand-in|Atlassian's Rovo MCP server/);
});

test("a sync through the server lists SYN's issues in the issues shape, as REST's does", async () => {
  const { opened, records } = await listAll(replayCalls(synced.calls));
  assert.equal(opened.identity, site);
  assert.match(opened.about, /^SYN on oriel\.atlassian\.net, through Atlassian's Rovo MCP server$/);
  const expected = fixtureSnapshot(fixture, site, fixture.edits.length).records;
  const byId = (a: IndexRecord, b: IndexRecord) => a.id.localeCompare(b.id);
  assert.deepEqual(records.toSorted(byId), expected.toSorted(byId));
});

test("a read through the server gives every region item's content", async () => {
  const opened = await openJira(connection, via(replayCalls([...synced.calls, ...reads.calls])));
  const ids = [...new Set(fixture.regions.flatMap((region) => region.items))];
  const read = await opened.source.read(ids);
  assert.equal(read.length, ids.length);
  // Every one SYN still has, and the one its edits deleted gone.
  const live = new Set<string>(
    fixtureSnapshot(fixture, site, fixture.edits.length).records.map((r) => r.id),
  );
  for (const each of read) assert.equal(each.status, live.has(each.id) ? "ok" : "gone", each.id);
  const first = read[0];
  assert.ok(first?.status === "ok");
  assert.equal(typeof first.content.title, "string");
  assert.ok(Array.isArray((first.content as { moves?: unknown }).moves));
});

test("each tool's answer reads as REST's body, from its text or its structured content", () => {
  const text = (value: unknown): ToolAnswer => ({
    content: [{ type: "text", text: JSON.stringify(value) }],
  });
  assert.deepEqual(bodyOf("getJiraIssue", text({ key: "SYN-1" })), {
    status: 200,
    body: { key: "SYN-1" },
  });
  assert.deepEqual(bodyOf("getJiraIssue", { content: [], structuredContent: { key: "SYN-2" } }), {
    status: 200,
    body: { key: "SYN-2" },
  });
  const failed = (words: string): ToolAnswer => ({
    content: [{ type: "text", text: words }],
    isError: true,
  });
  assert.equal(bodyOf("getJiraIssue", failed("Issue does not exist")).status, 404);
  assert.equal(bodyOf("getJiraIssue", failed("You do not have permission")).status, 403);
  assert.equal(bodyOf("getJiraIssue", failed("Unauthorized: sign in again")).status, 401);
  assert.equal(bodyOf("getJiraIssue", failed("Something went wrong")).status, 400);
  // A write that failed for no reason it gives may have landed.
  assert.equal(bodyOf("editJiraIssue", failed("Something went wrong"), true).status, 502);
  assert.equal(bodyOf("createJiraIssue", failed("Jira answered 500."), true).status, 500);
  assert.equal(
    bodyOf("editJiraIssue", failed("Jira answered 400. Field is locked"), true).status,
    400,
  );
  const site = siteOf(text([{ id: "c1", url: "https://acme.atlassian.net/", name: "acme" }]), null);
  assert.deepEqual(site, { cloudId: "c1", url: "https://acme.atlassian.net", name: "acme" });
});

test("the search reads REST's page and the paged one, and its cursor", () => {
  assert.deepEqual(searchBody({ issues: [1], nextPageToken: "t" }), {
    issues: [1],
    nextPageToken: "t",
    isLast: false,
  });
  assert.deepEqual(
    searchBody({ issues: { nodes: [1, 2], pageInfo: { hasNextPage: true, endCursor: "c" } } }),
    { issues: [1, 2], nextPageToken: "c", isLast: false },
  );
  assert.deepEqual(
    searchBody({ issues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } }),
    { issues: [], nextPageToken: null, isLast: true },
  );
});

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

test("a sync whose answer isn't JSON stops before it gives a page, naming the server", async () => {
  const garbled = altered("searchJiraIssuesUsingJql", () => ({
    content: [{ type: "text", text: "Here are your issues!" }],
  }));
  const opened = await openJira(connection, via(garbled));
  const given: unknown[] = [];
  await assert.rejects(
    (async () => {
      for await (const page of opened.source.sync(null)) given.push(page);
    })(),
    (error) => {
      assert.equal(
        opened.problem(error),
        "Atlassian's Rovo MCP server answered in a way Oriel didn't expect, so Oriel kept the window as it was.",
      );
      return error instanceof ServerUnreadable;
    },
  );
  assert.deepEqual(given, [], "no page reaches the index");
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

test("a site the server doesn't reach, or no project, stops the open with the server named", async () => {
  const none = altered("getAccessibleAtlassianResources", () => ({
    content: [{ type: "text", text: "[]" }],
  }));
  await assert.rejects(
    openJira(connection, via(none)),
    /Atlassian's Rovo MCP server reaches no Jira site/,
  );
  assert.match(serverProblem(new Error("x"), "Atlassian's Rovo MCP server"), /through Atlassian's/);
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
    /refusing a write/,
  );
  assert.equal(called, 0);
});

const [projectPick] = atlassianServer.picks ?? [];

test("the project picker lists the server's projects on its site, with their counts, through read tools", async () => {
  assert.equal(projectPick?.name, "project");
  const made: string[] = [];
  const replay = replayCalls(synced.calls);
  const read: ToolCaller = (call) => {
    made.push(call.tool);
    return replay(call);
  };
  const listed = await projectPick?.list(read, "", { identity: "", options: {} });
  assert.deepEqual(listed, {
    choices: [
      { value: "SYN", name: "Ferrowick", count: 120, updatedAt: "2026-10-01T14:00:00.000Z" },
    ],
    more: false,
  });
  assert.ok(made.every((tool) => atlassianServer.reads.includes(tool)));
  assert.equal((await projectPick?.list(read, "ferro", connection))?.choices.length, 1);
  assert.equal((await projectPick?.list(read, "syn", connection))?.choices.length, 1);
  assert.equal((await projectPick?.list(read, "nothing", connection))?.choices.length, 0);
});

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

test("the project picker reads each page the server says remains", async () => {
  const asked: unknown[] = [];
  const paged: ToolCaller = async (call) => {
    if (call.tool !== "listJiraProjects") return replayCalls(synced.calls)(call);
    asked.push(call.args.startAt);
    const at = Number(call.args.startAt ?? 0);
    const values = [{ key: `P${at}`, name: `Project ${at}` }];
    return { content: [{ type: "text", text: JSON.stringify({ values, isLast: at >= 2 }) }] };
  };
  const listed = await projectPick?.list(paged, "", connection);
  assert.deepEqual(
    listed?.choices.map((each) => each.value),
    ["P0", "P1", "P2"],
  );
  assert.deepEqual(asked, [undefined, 1, 2]);
});
