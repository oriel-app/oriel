// Slack through Slack's MCP server (decision 0059, OA-277), end to end
// through the routes: the person's agent is a fake that lists the server,
// and its processes call the stand-in's tools on Ferrowick in memory. Sync
// reads with the read tools only, a change set's replay writes with the
// write tool only, from another process, and an answer Oriel can't read
// keeps the index as it was.
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import type { FoundServer, ToolCall } from "@oriel/core";
import { fixtureApi, loadSlackFixture, slackServer } from "@oriel/slack";
import { slackStandIn, standInCaller, standInWorkspace } from "@oriel/slack/standin";
import type { DiffView, ThreadView } from "@oriel/web/view";
import { fakeAgent } from "./servers/testing.ts";
import { json, type Script, testApp } from "./testing.ts";

const { reads, writes } = slackServer;
const fixture = loadSlackFixture();
const weather = "C0FW1WEATHR";
const question = "1790071200.000100";

const slack = (over: Partial<FoundServer> = {}): FoundServer => ({
  name: "slack",
  status: "connected",
  reports: "Slack MCP",
  url: "https://mcp.slack.com/mcp",
  command: null,
  tools: [...reads, ...writes, "slack_search_public"],
  transport: "http",
  ...over,
});

type Made = { server: string; process: number; tools: readonly string[]; call: ToolCall };

async function world(
  t: TestContext,
  options: {
    // Slack's own token connection, beside the server.
    token?: true;
    script?: Script;
    // Changes an answer on its way back, as a server that changed might.
    answer?: (call: ToolCall, answer: unknown) => unknown;
    // The channels the person is in, the fixture's picked unless given.
    yours?: string[];
  } = {},
) {
  const workspace = standInWorkspace(fixture);
  const tools = standInCaller(
    slackStandIn(options.yours ? { ...fixture, picked: options.yours } : fixture, workspace),
  );
  const made: Made[] = [];
  let processes = 0;
  const agent = fakeAgent(() => [slack()]);
  const it = await testApp(t, {
    connect: {},
    ...(options.token
      ? {
          slack: {
            mode: "live",
            identity: fixture.team.url,
            options: { channels: fixture.picked },
            secret: "xoxp-test",
            fetch: fixtureApi(fixture).fetch,
          },
        }
      : {}),
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
  const turnOn = async () => {
    await it.post("/api/servers/look");
    const on = await it.post("/api/actions/source.on", { kind: "slack", server: "slack" });
    assert.equal(on.status, 200);
    await it.app.settled();
  };
  const slackRows = () =>
    it.app
      .window("epic")
      .clusters.flatMap((c) => c.list)
      .filter((row) => row.id.startsWith("slack:"));
  return { ...it, workspace, made, turnOn, slackRows };
}

test("Slack on through its server syncs the person's channel with its read tools only", async (t) => {
  const it = await world(t);
  assert.equal(await it.connection("slack"), null, "nothing of Slack before it's on");
  await it.turnOn();
  assert.ok(((await it.connection("slack"))?.items ?? 0) > 10);
  assert.ok(
    it.made.every((each) => reads.includes(each.call.tool)),
    "sync never writes",
  );
  assert.ok(
    it.made
      .filter((each) => each.call.tool === "slack_read_channel")
      .every((each) => each.call.args.channel_id === weather),
    "only the channel the person is in",
  );
  const synced = it.app.telemetry().filter((event) => event.name === "source.server-synced");
  assert.equal(synced.length, 1);
  assert.ok(!JSON.stringify(synced[0]?.data).includes("weather"), "never a channel's name");
});

const conversation = `slack:${weather}-${question}`;

// A thread whose agent replies to Amara, its change set approved: the
// thread as it is then, and the set's ID.
async function approvedReply(it: Awaited<ReturnType<typeof world>>) {
  const { id: workstreamId } = json<{ id: string }>(
    await it.post("/api/workstreams", { kind: "picked", name: "Rebooking", items: [conversation] }),
  );
  const { id: threadId } = json<{ id: string }>(
    await it.post(`/api/workstreams/${workstreamId}/threads`, { text: "Answer Amara" }),
  );
  await it.app.settled();
  const view = json<ThreadView>(await it.get(`/api/threads/${threadId}`));
  const entry = view.entries.find((each) => each.kind === "change-set");
  assert.ok(entry?.kind === "change-set", JSON.stringify(view.entries.map((e) => e.kind)));
  const diff = json<DiffView>(await it.post(`/api/change-sets/${entry.changeSetId}/diff`));
  assert.ok(diff.lines.every((line) => line.source === "Slack"));
  it.advance(1000);
  const approved = await it.post(`/api/change-sets/${entry.changeSetId}/approve`, {
    hash: diff.hash,
  });
  assert.equal(approved.status, 200);
  await it.app.settled();
  const after = json<ThreadView>(await it.get(`/api/threads/${threadId}`));
  const set = after.changeSets.find((each) => each.id === entry.changeSetId);
  assert.equal(set?.status, "applied");
  return { set, changeSetId: entry.changeSetId };
}

const reply: Script = async () => ({
  value: null,
  writes: [["slack.reply", [conversation, "On it"]]],
});

test("an approved reply replays through the write tool, from another process", async (t) => {
  const it = await world(t, { script: reply });
  await it.turnOn();
  await approvedReply(it);
  const written = it.made.filter((each) => writes.includes(each.call.tool));
  assert.equal(written.length, 1);
  const writer = written[0];
  assert.ok(writer);
  assert.deepEqual(writer.tools, writes, "the writing process has only the write tool");
  assert.ok(
    it.made.every((each) => each.process !== writer.process || writes.includes(each.call.tool)),
    "sync and replay never share a process",
  );
  const thread = await it.workspace.api("conversations.replies", {
    channel: weather,
    ts: question,
  });
  assert.ok(
    (thread as { messages: { text: string }[] }).messages.some((m) => m.text === "On it"),
    "the reply is in Slack",
  );
});

test("an answer Oriel can't read stops the sync with the server named, and keeps the index", async (t) => {
  let garble = false;
  const it = await world(t, {
    answer: (call, answer) =>
      garble && call.tool === "slack_read_channel"
        ? { content: [{ type: "text", text: "Here's what was said in #weather-disruptions:" }] }
        : answer,
  });
  await it.turnOn();
  const before = await it.connection("slack");
  const rows = it.slackRows();
  garble = true;
  it.workspace.replyAs("U0FWDARA01", weather, question, "Changed in Slack");
  const synced = await it.sync("slack");
  assert.equal(synced.status, 502);
  assert.ok((await it.connection("slack"))?.problem);
  assert.equal((await it.connection("slack"))?.items, before?.items);
  assert.deepEqual(it.slackRows(), rows);
});

const random = "C0FW2RANDOM";

test("the channels Slack's own connection read carry over when Slack turns on through its server", async (t) => {
  const it = await world(t, { token: true, yours: [weather, random] });
  const own = await it.connection("slack");
  await it.turnOn();
  const slack = await it.connection("slack");
  assert.equal(slack?.id, own?.id, "the same connection, so its items keep their IDs");
  assert.equal(slack?.through, "slack");
  assert.deepEqual(slack?.options, { channels: fixture.picked });
  const read = it.made.filter((each) => each.call.tool === "slack_read_channel");
  assert.ok(read.length > 0);
  assert.ok(
    read.every((each) => each.call.args.channel_id === weather),
    "not the first 20 the server lists",
  );
});
