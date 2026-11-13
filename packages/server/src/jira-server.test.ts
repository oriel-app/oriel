import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import type { FoundServer, ToolCall } from "@oriel/core";
import { atlassianServer } from "@oriel/jira";
import { atlassianStandIn, standInCaller, standInSite } from "@oriel/jira/standin";
import type { DiffView, ThreadView } from "@oriel/web/view";
import { fakeAgent } from "./servers/testing.ts";
import { json, type Script, testApp } from "./testing.ts";

const { reads, writes } = atlassianServer;

const atlassian = (over: Partial<FoundServer> = {}): FoundServer => ({
  name: "atlassian",
  status: "connected",
  reports: null,
  url: "https://mcp.atlassian.com/v2/mcp?tools=all",
  command: null,
  tools: [...reads, ...writes, "searchConfluenceUsingCql"],
  transport: "http",
  ...over,
});

type Made = { server: string; process: number; tools: readonly string[]; call: ToolCall };

async function world(
  t: TestContext,
  options: {
    found?: () => FoundServer[];
    script?: Script;
    answer?: (call: ToolCall, answer: unknown) => unknown;
  } = {},
) {
  const site = standInSite();
  const tools = standInCaller(atlassianStandIn(site));
  const made: Made[] = [];
  let processes = 0;
  const agent = fakeAgent(options.found ?? (() => [atlassian()]));
  const it = await testApp(t, {
    jira: false,
    discover: agent.discover,
    plan: () => [{ run: "script" }],
    scripts: { script: options.script ?? (async () => ({ value: null })) },
    callServer: async (server, allowed) => {
      const process = ++processes;
      return {
        agent: { id: "codex", name: "Codex", kind: "codex" },
        calls: {
          call: async (call) => {
            if (!allowed.includes(call.tool)) throw new Error(`${call.tool} isn't allowed`);
            made.push({ server: server.name, process, tools: allowed, call });
            const answer = await tools(call);
            return (options.answer?.(call, answer) ?? answer) as never;
          },
          close: () => {},
        },
      };
    },
  });
  await it.app.settled();
  const look = () => it.post("/api/servers/look");
  const turnOn = async (server = "atlassian") => {
    await look();
    const on = await it.post("/api/actions/source.on", { kind: "jira", server });
    assert.equal(on.status, 200);
    await it.app.settled();
  };
  const jiraRows = () =>
    it.app
      .window("epic")
      .clusters.flatMap((c) => c.list)
      .filter((row) => row.id.startsWith("jira:"));
  return { ...it, site, made, look, turnOn, jiraRows };
}

test("Jira on through Atlassian's server syncs SYN into the index with its read tools only", async (t) => {
  const it = await world(t);
  assert.equal(it.jiraRows().length, 0, "nothing of Jira before it's on");
  await it.turnOn();
  assert.ok(it.jiraRows().length > 20);
  assert.ok(it.made.length > 0);
  assert.ok(it.made.every((each) => each.server === "atlassian"));
  assert.ok(
    it.made.every((each) => reads.includes(each.call.tool)),
    "sync never writes",
  );
});

test("a server elsewhere that reports Atlassian's name isn't offered", async (t) => {
  const it = await world(t, {
    found: () => [atlassian({ name: "lookalike", url: "https://evil.example/mcp" })],
  });
  await it.look();
  const servers = (await it.connections()).servers;
  assert.deepEqual(servers.found, []);
  const on = await it.post("/api/actions/source.on", { kind: "jira", server: "lookalike" });
  assert.equal(on.status, 409);
});

test("an approved change set replays through the write tools, from another process", async (t) => {
  const rename: Script = async () => ({
    value: null,
    writes: [["jira.setSummary", ["jira:SYN-10", "Checkout through the server"]]],
  });
  const it = await world(t, { script: rename });
  await it.turnOn();
  const { id: workstreamId } = json<{ id: string }>(
    await it.post("/api/workstreams", { kind: "cluster", grouping: "epic", cluster: "10001" }),
  );
  const { id: threadId } = json<{ id: string }>(
    await it.post(`/api/workstreams/${workstreamId}/threads`, { text: "Rename it" }),
  );
  await it.app.settled();
  const view = json<ThreadView>(await it.get(`/api/threads/${threadId}`));
  const entry = view.entries.find((each) => each.kind === "change-set");
  assert.ok(entry?.kind === "change-set");
  const diff = json<DiffView>(await it.post(`/api/change-sets/${entry.changeSetId}/diff`));
  assert.ok(diff.lines.every((line) => line.source === "Jira"));
  it.advance(1000);
  const approved = await it.post(`/api/change-sets/${entry.changeSetId}/approve`, {
    hash: diff.hash,
  });
  assert.equal(approved.status, 200);
  await it.app.settled();
  assert.equal(it.site.issue("SYN-10")?.summary, "Checkout through the server");
  const written = it.made.filter((each) => writes.includes(each.call.tool));
  assert.deepEqual(
    written.map((each) => each.call),
    [
      {
        tool: "editJiraIssue",
        args: {
          cloudId: written[0]?.call.args.cloudId,
          issueIdOrKey: "SYN-10",
          fields: { summary: "Checkout through the server" },
        },
      },
    ],
  );
  const writer = written[0];
  assert.ok(writer);
  assert.deepEqual(writer.tools, writes, "the writing process has only the write tools");
  assert.ok(
    it.made.every((each) => each.process !== writer.process || writes.includes(each.call.tool)),
    "sync and replay never share a process",
  );
  assert.ok(it.jiraRows().some((row) => row.title === "Checkout through the server"));
});

test("a comment through the server lands, its ID found among the issue's, as the server's answer gives none", async (t) => {
  const note = "Closed as overtaken by the tool host.";
  const it = await world(t, {
    script: async () => ({
      value: null,
      writes: [
        ["jira.setStatus", ["jira:SYN-10", "In Progress"]],
        ["jira.addComment", ["jira:SYN-10", note]],
      ],
    }),
  });
  await it.turnOn();
  const { id: workstreamId } = json<{ id: string }>(
    await it.post("/api/workstreams", { kind: "cluster", grouping: "epic", cluster: "10001" }),
  );
  const { id: threadId } = json<{ id: string }>(
    await it.post(`/api/workstreams/${workstreamId}/threads`, { text: "Start it, and say so" }),
  );
  await it.app.settled();
  const view = json<ThreadView>(await it.get(`/api/threads/${threadId}`));
  const entry = view.entries.find((each) => each.kind === "change-set");
  assert.ok(entry?.kind === "change-set");
  const diff = json<DiffView>(await it.post(`/api/change-sets/${entry.changeSetId}/diff`));
  assert.ok(diff.lines.every((line) => line.check === null));
  assert.ok(
    it.made.some((each) => each.call.args.name === "listJiraIssueTransitions"),
    "the transitions were read",
  );
  it.advance(1000);
  const approved = await it.post(`/api/change-sets/${entry.changeSetId}/approve`, {
    hash: diff.hash,
  });
  assert.equal(json<{ changeSet: { status: string } }>(approved).changeSet.status, "applied");
  const comments = it.site.issue("SYN-10")?.comments ?? [];
  assert.equal(comments.length, 1);
  const [line] = json<DiffView>(
    await it.post(`/api/change-sets/${entry.changeSetId}/diff`),
  ).lines.slice(1);
  assert.ok(line?.applied);
  assert.deepEqual(
    line.fields.map((field) => field.name),
    [`comment:${comments[0]?.id}`],
  );
});

test("an answer Oriel can't read stops the sync with the server named, and keeps the index", async (t) => {
  let garble = false;
  const it = await world(t, {
    answer: (call, answer) =>
      garble && call.tool === "searchJiraIssuesUsingJql"
        ? { content: [{ type: "text", text: "Here are your issues!" }] }
        : answer,
  });
  await it.turnOn();
  const before = it.jiraRows();
  garble = true;
  it.site.edit("SYN-10", { summary: "Changed in Jira" });
  const synced = await it.sync("jira");
  assert.equal(synced.status, 502);
  assert.ok((await it.connection("jira"))?.problem);
  assert.deepEqual(it.jiraRows(), before);
});
