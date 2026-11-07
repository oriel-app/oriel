// The Atlassian stand-in answers as the real server's tools do, from SYN in
// memory, and its writes change only its own copy. No process starts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { atlassianServer } from "@oriel/jira";
import { atlassianInfo, atlassianStandIn, standInCloudId } from "@oriel/jira/standin";
import { standInServer } from "./mcp.ts";

const call = async (
  server: ReturnType<typeof standInServer>,
  name: string,
  args: Record<string, unknown> = {},
) => {
  const answer = await server.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: { cloudId: standInCloudId, ...args } },
  });
  assert.ok(answer && "result" in answer);
  const result = answer.result as { content: { text: string }[]; isError?: boolean };
  return {
    error: result.isError === true,
    body: JSON.parse(result.content[0]?.text ?? "null") as unknown,
    text: result.content[0]?.text ?? "",
  };
};

test("it reports the real server's name, and every tool Oriel's entry reads and writes with", async () => {
  const server = standInServer(atlassianInfo, atlassianStandIn());
  const opened = await server.handle({ jsonrpc: "2.0", id: 1, method: "server/discover" });
  assert.ok(opened && "result" in opened);
  const meta = opened.result._meta as Record<string, { name: string }>;
  assert.equal(meta["io.modelcontextprotocol/serverInfo"]?.name, atlassianServer.reports);
  const listed = await server.handle({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.ok(listed && "result" in listed);
  const tools = listed.result.tools as { name: string; annotations: { readOnlyHint: boolean } }[];
  for (const name of atlassianServer.reads)
    assert.equal(tools.find((tool) => tool.name === name)?.annotations.readOnlyHint, true, name);
  for (const name of atlassianServer.writes)
    assert.equal(tools.find((tool) => tool.name === name)?.annotations.readOnlyHint, false, name);
});

test("its search pages SYN as nodes, with a cursor to the next page", async () => {
  const server = standInServer(atlassianInfo, atlassianStandIn());
  const first = await call(server, "searchJiraIssuesUsingJql", {
    jql: "project = SYN",
    fields: ["summary"],
    maxResults: 5,
  });
  const page = (
    first.body as { issues: { nodes: { key: string }[]; pageInfo: { endCursor: string } } }
  ).issues;
  assert.equal(page.nodes.length, 5);
  const second = await call(server, "searchJiraIssuesUsingJql", {
    jql: "project = SYN",
    fields: ["summary"],
    maxResults: 5,
    nextPageToken: page.pageInfo.endCursor,
  });
  const next = (second.body as { issues: { nodes: { key: string }[] } }).issues.nodes;
  assert.ok(next.every((issue) => !page.nodes.some((seen) => seen.key === issue.key)));
});

test("a write changes its own copy, and another cloud ID reaches nothing", async () => {
  const server = standInServer(atlassianInfo, atlassianStandIn());
  const edited = await call(server, "editJiraIssue", {
    issueIdOrKey: "SYN-2",
    fields: { summary: "Renamed" },
  });
  assert.equal(edited.error, false);
  const read = await call(server, "getJiraIssue", { issueIdOrKey: "SYN-2", fields: ["summary"] });
  assert.equal((read.body as { fields: { summary: string } }).fields.summary, "Renamed");
  assert.equal(
    await standInServer(atlassianInfo, atlassianStandIn())
      .handle({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "getJiraIssue",
          arguments: { cloudId: "elsewhere", issueIdOrKey: "SYN-2" },
        },
      })
      .then((a) => (a && "result" in a ? a.result.isError : null)),
    true,
  );
  const missing = await server.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "getJiraIssue",
      arguments: { cloudId: standInCloudId, issueIdOrKey: "SYN-999" },
    },
  });
  assert.ok(missing && "result" in missing && missing.result.isError);
});
