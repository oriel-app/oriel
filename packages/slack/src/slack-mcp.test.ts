// Slack through Slack's MCP server (OA-277): the parser on each tool's
// answer, from `fixtures/slack-mcp/`'s recorded calls, its failing closed on
// an answer it can't read. No server runs: the recordings answer, or the
// stand-in in memory. Each mutation as the server's write call is in
// writer.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type IndexRecord,
  type ItemId,
  listed,
  type OpenVia,
  ServerUnreadable,
  type ThroughServer,
  type ToolAnswer,
  type ToolCall,
  type ToolCaller,
  type ToOpen,
  replayCalls,
} from "@oriel/core";
import { weather } from "../../../scripts/fixtures/slack.ts";
import { SlackError } from "./api.ts";
import { loadCalls } from "./calls-cassette.ts";
import { fixtureApi, loadSlackFixture } from "./fixture.ts";
import { openSlack, serverProblem } from "./open-connection.ts";
import { slackServer, slackServerApi, slackServerReads, slackTools } from "./slack-mcp.ts";
import { standInCaller } from "./slack-standin.ts";
import { slackSource } from "./source.ts";

const fixture = loadSlackFixture();
const synced = loadCalls("sync.json");
const reads = loadCalls("read.json");
const t = slackTools;

const connection: ToOpen = {
  id: "01JRECORDING00000000000000" as ToOpen["id"],
  number: 1,
  prefix: "slack",
  identity: fixture.team.url,
  options: { channels: fixture.picked },
  secret: null,
};

const through = (read: ToolCaller, write?: ToolCaller): ThroughServer => ({
  known: slackServer,
  found: {
    name: "slack",
    status: "connected",
    reports: "Slack MCP",
    url: "https://mcp.slack.com/mcp",
    command: null,
    tools: [...slackServer.reads, ...slackServer.writes],
  },
  read,
  write:
    write ??
    (async () => {
      throw new Error("nothing writes here");
    }),
});

const via = (read: ToolCaller): OpenVia => ({
  kept: false,
  log: () => {},
  now: () => "2026-11-07T00:00:00.000Z" as never,
  server: through(read),
});

const listAll = async (read: ToolCaller, options = connection) => {
  const opened = await openSlack(options, via(read));
  const records: IndexRecord[] = [];
  for await (const page of opened.source.sync(null)) records.push(...page.records);
  return { opened, records };
};

// The same, as the Web API gives it, through the fixture's own.
const plainly = () =>
  slackSource({
    api: fixtureApi(fixture).api,
    workspaceUrl: fixture.team.url,
    channels: fixture.picked,
    log: () => {},
  });

// One recorded answer changed: the first to `tool`, or every one.
const altered = (
  tool: string,
  change: (answer: ToolAnswer, call: ToolCall) => ToolAnswer,
): ToolCaller => {
  const replay = replayCalls(synced.calls);
  return async (call) => {
    const answer = await replay(call);
    return call.tool === tool ? change(answer, call) : answer;
  };
};
const json = (value: unknown): ToolAnswer => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
});
const bodyOf = (answer: ToolAnswer) =>
  JSON.parse(String((answer.content[0] as { text: string }).text)) as Record<string, unknown>;

test("the recordings say where they came from", () => {
  assert.match(synced.recorded, /stand-in|Slack's MCP server/);
  assert.match(reads.recorded, /stand-in|Slack's MCP server/);
});

test("a sync through the server lists the picked channel's conversations, as the Web API's does", async () => {
  const { opened, records } = await listAll(replayCalls(synced.calls));
  assert.equal(opened.identity, fixture.team.url);
  assert.equal(opened.about, "ferrowick-example.slack.com, through Slack's MCP server");
  const { records: expected } = await listed(plainly().sync(null));
  assert.ok(records.length > 10);
  assert.deepEqual(records, expected);
  assert.deepEqual(opened.context(), { channels: [weather], author: fixture.users[0]?.id });
});

test("a read through the server gives each conversation with its replies, as the Web API's does", async () => {
  const opened = await openSlack(connection, via(replayCalls([...synced.calls, ...reads.calls])));
  const { records } = await listed(plainly().sync(null));
  const ids = records.map((record) => record.id as ItemId<"slack">);
  const read = await opened.source.read(ids);
  assert.deepEqual(read, await plainly().read(ids));
  assert.ok(read.some((each) => each.status === "ok" && each.content.replies.length > 1));
});

test("it reads only with the server's read tools, the channel's by its ID", async () => {
  const made: ToolCall[] = [];
  const replay = replayCalls(synced.calls);
  await listAll(async (call) => {
    made.push(call);
    return replay(call);
  });
  assert.ok(made.every((call) => slackServer.reads.includes(call.tool)));
  const history = made.filter((call) => call.tool === t.history);
  assert.deepEqual(
    history.map((call) => call.args.channel_id),
    [weather],
    "nothing but the picked channel",
  );
});

test("with no channels picked, it reads the ones the person is in, as the server lists them", async () => {
  const { opened } = await listAll(standInCaller(), { ...connection, identity: "", options: {} });
  assert.deepEqual(opened.context(), { channels: fixture.picked, author: fixture.users[0]?.id });
});

test("a server that reads another workspace than the connection's doesn't open", async () => {
  await assert.rejects(
    openSlack(
      { ...connection, identity: "https://elsewhere.slack.com/" },
      via(replayCalls(synced.calls)),
    ),
    /reads another Slack workspace/,
  );
});

test("an answer it can't read stops the sync before any page lands, naming the server", async () => {
  const unreadable = [
    // Text that isn't JSON, as a server answering in prose would.
    altered(t.history, () => ({ content: [{ type: "text", text: "Here are the messages:" }] })),
    // No messages at all.
    altered(t.history, () => json({ results: [] })),
    // A message that isn't one.
    altered(t.history, (answer) => json({ ...bodyOf(answer), messages: [7] })),
    // A message with no `ts`, which it can't place.
    altered(t.history, (answer) =>
      json({
        ...bodyOf(answer),
        messages: [{ text: "no ts" }, ...(bodyOf(answer).messages as [])],
      }),
    ),
    // More remain, with no way to them.
    altered(t.history, (answer) =>
      json({ ...bodyOf(answer), has_more: true, response_metadata: {} }),
    ),
    // A message whose thread isn't a ts: left out, the sweep would take it.
    altered(t.history, (answer) => {
      const [first, ...rest] = bodyOf(answer).messages as Record<string, unknown>[];
      return json({ ...bodyOf(answer), messages: [{ ...first, thread_ts: "not-a-ts" }, ...rest] });
    }),
    // Paging said in a shape it can't read.
    altered(t.history, (answer) =>
      json({ ...bodyOf(answer), response_metadata: "broken", has_more: "true" }),
    ),
    // A cursor that isn't one.
    altered(t.history, (answer) =>
      json({ ...bodyOf(answer), response_metadata: { next_cursor: 4 } }),
    ),
  ];
  for (const read of unreadable) {
    const opened = await openSlack(connection, via(read));
    const pages: unknown[] = [];
    await assert.rejects(
      (async () => {
        for await (const page of opened.source.sync(null)) pages.push(page);
      })(),
      ServerUnreadable,
    );
    assert.equal(pages.length, 0, "no page landed");
    const error = await (async () => {
      try {
        for await (const _ of opened.source.sync(null));
      } catch (caught) {
        return caught;
      }
    })();
    assert.equal(
      opened.problem(error),
      "Slack's MCP server answered in a way Oriel didn't expect, so Oriel kept the window as it was.",
    );
  }
});

test("who the person is, and their workspace, come from their profile, only at Slack's own address", async () => {
  const profile = (change: (body: Record<string, unknown>) => unknown) =>
    altered(t.profile, (answer, call) =>
      call.args.user_id === undefined ? json(change(bodyOf(answer))) : answer,
    );
  for (const url of [
    "http://ferrowick-example.slack.com/",
    "https://slack.evil.example/",
    undefined,
  ])
    await assert.rejects(
      openSlack(connection, via(profile((body) => ({ ...body, workspace_url: url })))),
      ServerUnreadable,
    );
  await assert.rejects(
    openSlack(connection, via(profile((body) => ({ ...body, user_id: undefined })))),
    /didn't say who you are/,
  );
  // As a profile under `user`, or with the address as `team_url`.
  const nested = await openSlack(
    connection,
    via(
      profile((body) => ({
        user: { id: body.user_id, team_id: body.team_id, profile: body.profile },
        team_url: body.workspace_url,
      })),
    ),
  );
  assert.equal(nested.identity, fixture.team.url);
});

test("a failed tool names Slack's code, so a missing thread reads as deleted and a sign-in as one", async () => {
  const api = slackServerReads({
    read: async (call) => ({
      content: [
        {
          type: "text",
          text:
            call.tool === t.thread
              ? "Slack refused it: thread_not_found"
              : call.tool === t.history
                ? "You need to sign in again"
                : "Something went wrong",
        },
      ],
      isError: true,
    }),
  });
  await assert.rejects(
    api("conversations.replies", { channel: weather, ts: "1788444000.000100" }),
    (error) => error instanceof SlackError && error.code === "thread_not_found",
  );
  const signIn = await api("conversations.history", { channel: weather }).catch((e: unknown) => e);
  assert.ok(signIn instanceof SlackError && signIn.code === "not_authed");
  assert.equal(
    serverProblem(signIn, "Slack's MCP server"),
    "Slack's MCP server turned Oriel away, so the window may be behind Slack. Sign in to it again in your agent.",
  );
  await assert.rejects(
    api("users.profile.get", { user: "U0FWAMARA1" }),
    (error) => error instanceof SlackError && error.code === "failed",
  );
});

test("Slack's names for a message's fields are read as the Web API's", async () => {
  const api = slackServerReads({
    read: async () =>
      json({
        messages: [{ message_ts: "1788444000.000100", user_id: "U0FWDARA01", text: "Decided" }],
      }),
  });
  assert.deepEqual(await api("conversations.history", { channel: weather }), {
    ok: true,
    messages: [{ ts: "1788444000.000100", user: "U0FWDARA01", text: "Decided" }],
    response_metadata: { next_cursor: "" },
  });
});

test("the read side refuses a post before anything is sent", async () => {
  let calls = 0;
  const api = slackServerReads({
    read: async () => {
      calls += 1;
      return json({});
    },
  });
  await assert.rejects(
    api("chat.postMessage" as never, { channel: weather, text: "hi" }),
    /refusing a method/,
  );
  await assert.rejects(
    slackServerApi({ read: async () => json({}) })("chat.postMessage", { channel: weather }),
    /refusing a write on the read side/,
  );
  assert.equal(calls, 0);
});

const [channelsPick] = slackServer.picks ?? [];

test("the channel picker lists the person's channels by ID, through read tools, up to 20 picked", async () => {
  assert.equal(channelsPick?.name, "channels");
  assert.equal(channelsPick?.many, true);
  assert.equal(channelsPick?.most, 20);
  assert.equal(channelsPick?.unpicked, "your first 20 channels");
  const made: string[] = [];
  const replay = replayCalls(synced.calls);
  const read: ToolCaller = (call) => {
    made.push(call.tool);
    return replay(call);
  };
  assert.deepEqual(await channelsPick?.list(read, "", connection), {
    choices: [{ value: weather, name: "#weather-disruptions", count: null, updatedAt: null }],
    more: false,
  });
  assert.deepEqual(made, [t.channels]);
  assert.equal((await channelsPick?.list(read, "WEATHER", connection))?.choices.length, 1);
  assert.equal((await channelsPick?.list(read, "random", connection))?.choices.length, 0);
});

test("the channel picker reads every page once, and stops on one the server repeats or can't give", async () => {
  let calls = 0;
  const paged: ToolCaller = async (call) => {
    calls += 1;
    const at = Number(call.args.cursor ?? 0);
    const page = {
      channels: [{ id: `C${at}`, name: `c-${at}`, is_archived: at === 1 }],
      // The third page names the second's cursor again.
      response_metadata: { next_cursor: String(at >= 2 ? 1 : at + 1) },
    };
    return { content: [{ type: "text", text: JSON.stringify(page) }] };
  };
  const listed = await channelsPick?.list(paged, "", connection);
  assert.deepEqual(
    listed?.choices.map((each) => each.value),
    ["C0", "C2"],
    "archived ones aren't offered",
  );
  assert.equal(calls, 3, "it stops at the cursor it had read before");
  const broken: ToolCaller = async () => ({
    content: [{ type: "text", text: JSON.stringify({ channels: [{ name: "no id" }] }) }],
  });
  await assert.rejects(
    channelsPick?.list(broken, "", connection) ?? Promise.resolve(),
    ServerUnreadable,
  );
});
