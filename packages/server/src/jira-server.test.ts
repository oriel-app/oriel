// Jira through Atlassian's MCP server (decision 0059, OA-276), end to end
// through the routes: the person's agent is a fake that lists the server,
// and its processes call the stand-in's tools on SYN in memory. Sync reads
// with the read tools only, a change set's replay writes with the write
// tools only, from another process, and an answer Oriel can't read keeps
// the index as it was.
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import type { FoundServer, ToolCall } from "@oriel/core";
import { atlassianServer } from "@oriel/jira";
import { atlassianStandIn, standInCaller, standInSite } from "@oriel/jira/standin";
import type { DiffView, ThreadView } from "@oriel/web/view";
import { fakeAgent } from "./servers/testing.ts";
import { account, json, type Script, testApp } from "./testing.ts";

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
    live?: boolean;
    script?: Script;
    // Changes an answer on its way back, as a server that changed might.
    answer?: (call: ToolCall, answer: unknown) => unknown;
    every?: (ms: number, then: () => void) => () => void;
  } = {},
) {
  const site = standInSite();
  const tools = standInCaller(atlassianStandIn(site));
  const made: Made[] = [];
  let processes = 0;
  const agent = fakeAgent(options.found ?? (() => [atlassian()]));
  const it = await testApp(t, {
    ...(options.live ? { live: true } : { connect: {} }),
    ...(options.every ? { every: options.every } : {}),
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
          spent: () => ({
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            costUsd: 0,
            turns: 0,
          }),
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
  const jira = await it.connection("jira");
  assert.equal(jira?.about, "SYN on oriel.atlassian.net, through Atlassian's Rovo MCP server");
  assert.equal(jira?.through, "atlassian");
  assert.deepEqual((await it.connections()).standingIn, [], "the stand-in tracker steps aside");
  assert.ok(it.made.length > 0);
  assert.ok(it.made.every((each) => each.server === "atlassian"));
  assert.ok(
    it.made.every((each) => reads.includes(each.call.tool)),
    "sync never writes",
  );
  const synced = it.app.telemetry().filter((event) => event.name === "source.server-synced");
  assert.equal(synced.length, 1);
  const data = synced[0]?.data as Record<string, unknown>;
  assert.equal(data.source, "jira");
  assert.equal(data.agent, "codex");
  assert.equal(data.ok, true);
  assert.ok((data.items as number) > 20);
  assert.deepEqual(Object.keys(data).toSorted(), ["agent", "items", "ms", "ok", "source"]);
});

test("of two servers at Atlassian's address, only the one the person picked syncs", async (t) => {
  let found = [atlassian(), atlassian({ name: "work-atlassian" })];
  const it = await world(t, { found: () => found });
  await it.turnOn("work-atlassian");
  assert.ok(it.jiraRows().length > 0);
  assert.ok(it.made.every((each) => each.server === "work-atlassian"));
  // The picked one goes; the other, at the same address, doesn't keep Jira on.
  found = [atlassian()];
  const calls = it.made.length;
  await it.look();
  await it.app.settled();
  assert.equal(it.jiraRows().length, 0);
  assert.equal(it.made.length, calls, "nothing called the other");
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
  // The index has the new summary, read back through the read tools.
  assert.ok(it.jiraRows().some((row) => row.title === "Checkout through the server"));
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
  const problem =
    "Atlassian's Rovo MCP server answered in a way Oriel didn't expect, so Oriel kept the window as it was.";
  assert.equal(synced.status, 502);
  assert.deepEqual(json(synced), { error: problem });
  assert.equal((await it.connection("jira"))?.problem, problem);
  assert.deepEqual(it.jiraRows(), before);
});

test("with Jira's own connection and Atlassian's server both on, Jira reads through the server", async (t) => {
  const it = await world(t, { live: true });
  assert.ok(it.jiraRows().length > 0, "the REST connection reads first");
  assert.equal(it.made.length, 0);
  await it.turnOn();
  const jira = await it.connection("jira");
  assert.match(jira?.about ?? "", /through Atlassian's Rovo MCP server$/);
  assert.ok(it.made.length > 0);
});

test("turned on through its server, Jira is offered the stand-in's issues, and makes them with its write tools", async (t) => {
  const plan: Script = async () => ({
    value: null,
    writes: [
      ["tracker.createEpic", [{ summary: "Spring launch" }], "new:1"],
      ["tracker.createStory", [{ summary: "Pricing page", epic: "new:1" }], "new:2"],
    ],
  });
  const it = await world(t, { script: plan });
  // The window chat's plan lands in the stand-in first.
  await it.post("/api/window-chat/messages", { text: "Draft a launch" });
  await it.app.settled();
  const chat = json<{ thread: string }>(await it.get("/api/window-chat")).thread;
  const drafted = json<ThreadView>(await it.get(`/api/threads/${chat}`));
  const first = drafted.entries.find((each) => each.kind === "change-set");
  assert.ok(first?.kind === "change-set");
  const approve = async (id: string) => {
    const diff = json<DiffView>(await it.post(`/api/change-sets/${id}/diff`));
    it.advance(1000);
    const reply = await it.post(`/api/change-sets/${id}/approve`, { hash: diff.hash });
    await it.app.settled();
    return reply.status;
  };
  assert.equal(await approve(first.changeSetId), 200);
  await it.turnOn();
  assert.deepEqual(
    (await it.connections()).connections.map((each) => each.kind),
    ["jira", "tracker"],
    "both stay while the offer waits",
  );
  const threads = json<{ threads: { id: string; title: string }[] }>(await it.get("/api/threads"));
  const into = threads.threads.find((each) => each.title === "Into Jira");
  assert.ok(into);
  const offer = json<ThreadView>(await it.get(`/api/threads/${into.id}`)).entries.find(
    (each) => each.kind === "change-set",
  );
  assert.ok(offer?.kind === "change-set");
  assert.equal(await approve(offer.changeSetId), 200);
  const made = it.made.filter((each) => each.call.tool === "createJiraIssue");
  assert.deepEqual(
    made.map((each) => [each.call.args.summary, each.call.args.issueTypeName]),
    [
      ["Spring launch", "Epic"],
      ["Pricing page", "Story"],
    ],
  );
  assert.ok(made.every((each) => each.tools === writes));
  assert.deepEqual(
    (await it.connections()).connections.map((each) => each.kind),
    ["jira"],
    "the stand-in steps aside",
  );
});

test("set to sync every few minutes, each tick syncs Jira through its server", async (t) => {
  const ticks: (() => void)[] = [];
  const it = await world(t, { every: (_ms, then) => (ticks.push(then), () => {}) });
  await it.turnOn();
  assert.equal((await it.post("/api/settings", { sourceSync: 15 })).status, 200);
  const before = it.made.filter((each) => each.call.tool === "searchJiraIssuesUsingJql").length;
  ticks.at(-1)?.();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await it.app.settled();
  const after = it.made.filter((each) => each.call.tool === "searchJiraIssuesUsingJql").length;
  assert.ok(after > before, "the tick synced through the server");
});

// The server's project list with another before SYN, as a site with two
// has it.
const twoProjects = (call: ToolCall, answer: unknown) => {
  if (call.tool !== "listJiraProjects") return answer;
  const values = [
    { id: "10001", key: "OPS", name: "Pier operations" },
    { id: "10000", key: "SYN", name: "Ferrowick" },
  ];
  return { content: [{ type: "text", text: JSON.stringify({ isLast: true, values }) }] };
};

test("Jira's project is picked through its server, and the pick bounds the next sync", async (t) => {
  const it = await world(t, { answer: twoProjects });
  await it.turnOn();
  const before = await it.connection("jira");
  assert.deepEqual(before?.options, {}, "nothing picked: the server's first");
  assert.deepEqual(
    before?.picks.map((pick) => [pick.name, pick.many, pick.unpicked]),
    [["project", false, "the first project it lists"]],
  );
  assert.match(before?.about ?? "", /^OPS on /);
  const id = before?.id ?? "";
  const listed = json<{ choices: { value: string; name: string }[] }>(
    await it.post(`/api/connections/${id}/pick`, { query: "", field: "project" }),
  );
  assert.deepEqual(
    listed.choices.map((each) => each.value),
    ["OPS", "SYN"],
  );
  it.made.length = 0;
  const set = await it.post(`/api/connections/${id}/options`, { options: { project: "SYN" } });
  assert.equal(set.status, 200);
  await it.app.settled();
  const after = await it.connection("jira");
  assert.equal(after?.id, id, "the same connection, kept");
  assert.match(after?.about ?? "", /^SYN on /);
  const searched = it.made.filter((each) => each.call.tool === "searchJiraIssuesUsingJql");
  assert.ok(searched.length > 0);
  assert.ok(searched.every((each) => String(each.call.args.jql).startsWith('project in ("SYN")')));
  assert.ok(it.jiraRows().length > 20);
  assert.ok(
    it.made.every((each) => reads.includes(each.call.tool)),
    "never a write tool",
  );
});

test("a project picked in Jira's own connection carries over when Jira turns on through its server", async (t) => {
  const it = await world(t, { answer: twoProjects });
  const made = await it.connect("jira", {
    site: "oriel.atlassian.net",
    email: account.email,
    token: account.token,
    project: "SYN",
  });
  assert.equal(made.status, 200);
  const own = json<{ connection: { id: string } }>(made).connection;
  await it.turnOn();
  const jira = await it.connection("jira");
  assert.equal(jira?.id, own.id, "the same connection, so its items keep their IDs");
  assert.equal(jira?.through, "atlassian");
  assert.deepEqual(jira?.options, { project: "SYN" }, "not the server's first, OPS");
  assert.match(jira?.about ?? "", /^SYN on oriel\.atlassian\.net, through /);
  assert.equal(jira?.picks.length, 1, "and it's picked again through the server");
});
