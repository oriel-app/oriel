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
  } = {},
) {
  const workspace = standInWorkspace(fixture);
  const tools = standInCaller(slackStandIn(fixture, workspace));
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
  const connection = await it.connection("slack");
  assert.equal(connection?.about, "ferrowick-example.slack.com, through Slack's MCP server");
  assert.equal(connection?.through, "slack");
  assert.equal(
    connection?.state,
    "open",
    "it reads the channels the server lists, waiting for none",
  );
  assert.ok((connection?.items ?? 0) > 10);
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
  const data = synced[0]?.data as Record<string, unknown>;
  assert.equal(data.source, "slack", "its kind, never a channel's name");
  assert.deepEqual(Object.keys(data).toSorted(), ["agent", "items", "ms", "ok", "source"]);
  assert.ok(!JSON.stringify(data).includes("weather"));
});

test("an approved reply replays through the write tool, from another process", async (t) => {
  const conversation = `slack:${weather}-${question}`;
  const reply: Script = async () => ({
    value: null,
    writes: [["slack.reply", [conversation, "On it"]]],
  });
  const it = await world(t, { script: reply });
  await it.turnOn();
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
  const written = it.made.filter((each) => writes.includes(each.call.tool));
  assert.deepEqual(
    written.map((each) => each.call),
    [
      {
        tool: "slack_send_message",
        args: { channel_id: weather, message: "On it", thread_ts: question },
      },
    ],
  );
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
  const problem =
    "Slack's MCP server answered in a way Oriel didn't expect, so Oriel kept the window as it was.";
  assert.equal(synced.status, 502);
  assert.deepEqual(json(synced), { error: problem });
  assert.equal((await it.connection("slack"))?.problem, problem);
  assert.equal((await it.connection("slack"))?.items, before?.items);
  assert.deepEqual(it.slackRows(), rows);
});

test("with Slack's token connection and its server both on, Slack reads through the server, in the picked channels", async (t) => {
  const it = await world(t, { token: true });
  assert.ok(((await it.connection("slack"))?.items ?? 0) > 0, "the token connection reads first");
  assert.equal(it.made.length, 0);
  await it.turnOn();
  const connection = await it.connection("slack");
  assert.match(connection?.about ?? "", /through Slack's MCP server$/);
  assert.ok(it.made.some((each) => each.call.tool === "slack_read_channel"));
  // Its items keep their IDs: one connection, not a second.
  assert.equal(
    (await it.connections()).connections.filter((each) => each.kind === "slack").length,
    1,
  );
});

test("Slack off: nothing of it shows, and its server calls stop", async (t) => {
  const it = await world(t);
  await it.turnOn();
  assert.ok((await it.connection("slack"))?.items);
  const off = await it.post("/api/actions/source.off", { kind: "slack" });
  assert.equal(off.status, 200);
  await it.app.settled();
  assert.equal(await it.connection("slack"), null);
  assert.deepEqual(it.slackRows(), []);
  const calls = it.made.length;
  await it.sync("slack");
  assert.equal(it.made.length, calls);
});
