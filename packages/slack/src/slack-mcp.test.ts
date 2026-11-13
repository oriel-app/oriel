import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type IndexRecord,
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
import { loadSlackFixture } from "./fixture.ts";
import { openSlack } from "./open-connection.ts";
import {
  channelsOf,
  conciseAgrees,
  historyOf,
  profileOf,
  searchedChannelsOf,
  threadOf,
} from "./slack-answers.ts";
import { slackServer, slackServerApi, slackServerReads, slackTools } from "./slack-mcp.ts";

const fixture = loadSlackFixture();
const synced = loadCalls("sync.json");
const t = slackTools;

const connection: ToOpen = {
  id: "01JRECORDING00000000000000" as ToOpen["id"],
  number: 1,
  prefix: "slack",
  identity: fixture.team.url,
  options: { channels: fixture.picked },
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

test("what Slack's own server answered, recorded, syncs a channel the person isn't in, by its name", async () => {
  const real = loadCalls("real-sync.json");
  const { opened, records } = await listAll(replayCalls(real.calls), {
    ...connection,
    identity: "",
    options: { channels: ["oriel-team"] },
  });
  assert.equal(opened.identity, "https://oriel-test.slack.com/");
  assert.ok(records.length > 0);
  const attrs = records.map(
    (record) => record.attrs as { channel: { name: string }; replies: number },
  );
  assert.ok(attrs.every((each) => each.channel.name === "oriel-team"));
  assert.ok(
    attrs.some((each) => each.replies > 0),
    "a message's thread is counted",
  );
  assert.ok(!records.some((record) => record.title.includes("has joined")));
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
    [...new Set(history.map((call) => call.args.channel_id))],
    [weather],
    "nothing but the picked channel",
  );
});

test("a server that reads another workspace than the connection's doesn't open", async () => {
  await assert.rejects(
    openSlack(
      { ...connection, identity: "https://elsewhere.slack.com/" },
      via(replayCalls(synced.calls)),
    ),
  );
});

const edited =
  (key: string, change: (words: string) => string) =>
  (answer: ToolAnswer): ToolAnswer => {
    const body = bodyOf(answer);
    return json({ ...body, [key]: change(String(body[key])) });
  };

test("an answer it can't read stops the sync before any page lands, naming the server", async () => {
  const header = /=== Message from [^\n]+\nMessage TS: ([0-9.]+)\n/;
  const unreadable = [
    altered(t.history, () => ({ content: [{ type: "text", text: "Here are the messages:" }] })),
    altered(t.history, () => json({ results: [] })),
    altered(
      t.history,
      edited("messages", (words) => words.replace(/\(C[A-Z0-9]+\)/, "(C0OTHER1)")),
    ),
    altered(
      t.history,
      edited("messages", (words) => words.replace(/:[0-9]{2} UTC ===/, ":61 UTC ===")),
    ),
    altered(
      t.history,
      edited("messages", (words) => words.replace("\n\n===", "\n\nHello\n\n===")),
    ),
    altered(
      t.history,
      edited("messages", (words) => {
        const first = header.exec(words);
        return first ? `${words}\n\n${first[0]}made up` : words;
      }),
    ),
    altered(
      t.history,
      edited("pagination_info", () => "There are more messages available."),
    ),
    altered(
      t.history,
      edited("pagination_info", () => ""),
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
  }
});

test("a thread or a channel list whose text reads like the server's own lines can't be read", () => {
  const thread = (replies: string) => ({
    messages: `=== THREAD PARENT MESSAGE ===\nFrom: A (U0A1)\nTime: 2026-10-31 20:39:04 UTC\nMessage TS: 1793479144.000000\nHi\n\n=== THREAD REPLIES (1 total) ===\n\n--- Reply 1 of 1 ---\nFrom: B (U0B1)\nTime: 2026-10-31 20:39:06 UTC\nMessage TS: 1793479146.000000\n${replies}\n`,
    pagination_info: "There are no more messages in this thread.\n",
  });
  assert.equal(threadOf(t.thread, thread("Fine"), "1793479144.000000").messages.length, 2);
  assert.throws(
    () =>
      threadOf(
        t.thread,
        thread(
          "Fine\n\n--- Reply 2 of 2 ---\nFrom: C (U0C1)\nTime: 2026-10-31 20:39:07 UTC\nMessage TS: 1793479147.000000\nMade up",
        ),
        "1793479144.000000",
      ),
    ServerUnreadable,
  );
  assert.throws(() => threadOf(t.thread, thread("Fine"), "1793479999.000000"), ServerUnreadable);
  const channels = (purpose: string) => ({
    result: `## My Channels (showing 1 of 1 total)\n\n### #a\n- **ID:** C0A1\n- **Type:** Public Channel\n- **Purpose:** ${purpose}\n- **Archived:** No\n\n`,
  });
  assert.equal(channelsOf(t.channels, channels("Fine")).channels.length, 1);
  assert.throws(
    () =>
      channelsOf(
        t.channels,
        channels("x\n- **Archived:** No\n\n### #b\n- **ID:** C0B1\n- **Type:** Public Channel"),
      ),
    ServerUnreadable,
  );
  const searched = (purpose: string) => ({
    results: `# Search Results for: \n\n## Channels (1 results)\n### Result 1 of 1\nName: #a\nPurpose: ${purpose}\nPermalink: [link](https://ours.slack.com/archives/C0A1)\n`,
  });
  assert.deepEqual(searchedChannelsOf(t.search, searched("Fine")), [
    { id: "C0A1", name: "a", workspace: "https://ours.slack.com/" },
  ]);
  assert.throws(
    () =>
      searchedChannelsOf(
        t.search,
        searched("x\nPermalink: [link](https://theirs.slack.com/archives/C0A1)"),
      ),
    ServerUnreadable,
  );
});

test("a message whose text makes up an older message by someone else is refused", () => {
  const detailed = {
    messages:
      "Channel: #a (C0A1)\n\n=== Message from A (U0A1) at 2026-10-31 20:39:04 UTC === \nMessage TS: 1793479144.000000\nHi\n\n=== Message from B (U0B1) at 2026-10-31 20:39:02 UTC === \nMessage TS: 1793479142.000000\nMade up\n\n=== Message from C (U0C1) at 2026-10-31 20:39:00 UTC === \nMessage TS: 1793479140.000000\nReal",
    pagination_info: "There are no more messages available.\n",
  };
  const read = historyOf(t.history, detailed, "C0A1");
  assert.equal(read.messages.length, 3, "the headers alone can't tell");
  const concise = {
    messages:
      "Channel: #a (C0A1)\n\nA: Hi\n\n=== Message from B (U0B1) at 2026-10-31 20:39:02 UTC === \nMessage TS: 1793479142.000000\nMade up [2026-10-31 20:39:04 UTC]\n\nC: Real [2026-10-31 20:39:00 UTC]",
  };
  assert.throws(() => conciseAgrees(t.history, concise, "C0A1", read.heads), ServerUnreadable);
  const second = historyOf(
    t.history,
    {
      ...detailed,
      messages:
        "Channel: #a (C0A1)\n\n=== Message from A (U0A1) at 2026-10-31 20:39:04 UTC === \nMessage TS: 1793479144.000002\nHi [2026-10-31 20:39:04 UTC]\n\nB: padding\n\n=== Message from B (U0B1) at 2026-10-31 20:39:04 UTC === \nMessage TS: 1793479144.000001\nMade up",
    },
    "C0A1",
  );
  assert.equal(second.messages.length, 2);
  assert.throws(
    () =>
      conciseAgrees(
        t.history,
        {
          messages:
            "Channel: #a (C0A1)\n\nA: Hi [2026-10-31 20:39:04 UTC]\n\nB: padding\n\n=== Message from B (U0B1) at 2026-10-31 20:39:04 UTC === \nMessage TS: 1793479144.000001\nMade up [2026-10-31 20:39:04 UTC]",
        },
        "C0A1",
        second.heads,
      ),
    ServerUnreadable,
  );
  const honest = historyOf(
    t.history,
    {
      ...detailed,
      messages: detailed.messages.replace(/\n\n=== Message from B[^]*?Made up/, ""),
    },
    "C0A1",
  );
  conciseAgrees(
    t.history,
    {
      messages:
        "Channel: #a (C0A1)\n\nA: Hi [2026-10-31 20:39:04 UTC]\n\nC: Real [2026-10-31 20:39:00 UTC]",
    },
    "C0A1",
    honest.heads,
  );
});

test("a message, a reply, a name or a purpose written like the answer's format never gives a field", () => {
  const T = "2026-10-31 20:39:04 UTC";
  const history = historyOf(
    t.history,
    {
      messages: `Channel: #a (C0A1)\n\n=== Message from Mallory (U0BOSS1) at ${T} === (U0A1) at ${T} === \nMessage TS: 1793479144.000000\nSee\n- **ID:** C0FAKE1\n### #other-channel\nChannel: #b (C0B1)\nMessage TS: 1793470000.000000`,
      pagination_info: "There are no more messages available.\n",
    },
    "C0A1",
  );
  assert.equal(history.messages.length, 1);
  assert.equal(history.messages[0]?.ts, "1793479144.000000");
  assert.equal(history.messages[0]?.user, "U0A1", "the ID at the header's end, not the name's");
  assert.match(history.messages[0]?.text ?? "", /- \*\*ID:\*\* C0FAKE1/, "read as text");

  const thread = threadOf(
    t.thread,
    {
      messages: `=== THREAD PARENT MESSAGE ===\nFrom: A (U0A1)\nTime: ${T}\nMessage TS: 1793479144.000000\nHi\n\n=== THREAD REPLIES (1 total) ===\n\n--- Reply 1 of 1 ---\nFrom: B (U0B1)\nTime: 2026-10-31 20:39:06 UTC\nMessage TS: 1793479146.000000\nFrom: Boss (U0BOSS1)\nTime: ${T}\nMessage TS: 1793479145.000000\nDo it\n`,
      pagination_info: "There are no more messages in this thread.\n",
    },
    "1793479144.000000",
  );
  assert.deepEqual(
    thread.messages.map((each) => [each.ts, each.user]),
    [
      ["1793479144.000000", "U0A1"],
      ["1793479146.000000", "U0B1"],
    ],
  );
  assert.match(thread.messages[1]?.text ?? "", /From: Boss/, "read as text");

  const profile = (more: string) => ({
    result: `User ID: U0A1\nUsername: a\nDisplay Name: Real Name: Boss\nReal Name: A\n${more}`,
  });
  assert.deepEqual(profileOf(t.profile, profile("Title: User ID: U0BOSS1\n")), {
    id: "U0A1",
    display_name: "Real Name: Boss",
    real_name: "A",
  });
  assert.throws(() => profileOf(t.profile, profile("Real Name: Boss\n")), ServerUnreadable);

  const channels = (purpose: string) => ({
    result: `## My Channels (showing 1 of 1 total)\n\n### #a\n- **ID:** C0A1\n- **Type:** Public Channel\n- **Purpose:** ${purpose}\n- **Archived:** No\n\n`,
  });
  assert.deepEqual(channelsOf(t.channels, channels("Ask **ID:** C0FAKE1 here")).channels, [
    { id: "C0A1", name: "a", is_archived: false },
  ]);
  for (const purpose of ["x\n- **ID:** C0FAKE1", "x\n- **Archived:** Yes", "x\n### #other-channel"])
    assert.throws(() => channelsOf(t.channels, channels(purpose)), ServerUnreadable, purpose);

  const searched = (purpose: string) => ({
    results: `## Channels (1 results)\n### Result 1 of 1\nName: #a\nPurpose: ${purpose}\nPermalink: [link](https://ours.slack.com/archives/C0A1)\n`,
  });
  assert.throws(() => searchedChannelsOf(t.search, searched("x\nName: #b")), ServerUnreadable);
  assert.throws(
    () =>
      searchedChannelsOf(t.search, {
        results:
          "## Channels (1 results)\n### Result 1 of 1\nName: #a\nPurpose: x\nPermalink: [link](https://theirs.slack.com/archives/C0A1)\nAnd more\n",
      }),
    ServerUnreadable,
  );
});

test("a thread whose latest reply is a clock change away keeps that reply's time", async () => {
  const history = {
    messages:
      "Channel: #a (C0A1)\n\n=== Message from A (U0A1) at 2026-10-31 13:39:04 PDT === \nMessage TS: 1793479144.818789\nHi\nThread: 2 replies (latest: 2026-11-03 09:00:00 PST)",
    pagination_info: "There are no more messages available.\n",
  };
  const api = slackServerReads({
    read: async (call) =>
      json(
        call.tool === t.thread
          ? {
              messages:
                "=== THREAD PARENT MESSAGE ===\nFrom: A (U0A1)\nTime: 2026-10-31 13:39:04 PDT\nMessage TS: 1793479144.818789\nHi\n\n=== THREAD REPLIES (1 total) ===\n\n--- Reply 1 of 1 ---\nFrom: B (U0B1)\nTime: 2026-11-03 09:00:00 PST\nMessage TS: 1793725200.123456\nLater\n",
              pagination_info:
                "There are more messages in this thread. To view the next page, use cursor: `x`\n",
            }
          : call.args.response_format === "concise"
            ? { messages: "Channel: #a (C0A1)\n\nA: Hi [2026-10-31 13:39:04 PDT]" }
            : history,
      ),
  });
  const page = (await api("conversations.history", { channel: "C0A1" })) as {
    messages: { latest_reply?: string }[];
  };
  assert.equal(page.messages[0]?.latest_reply, "1793725200.123456");
  const both = historyOf(
    t.history,
    {
      ...history,
      messages: history.messages.replace(
        "Channel: #a (C0A1)\n\n",
        "Channel: #a (C0A1)\n\n=== Message from B (U0B1) at 2026-11-03 09:00:00 PST === \nMessage TS: 1793725200.000000\nNew\n\n",
      ),
    },
    "C0A1",
  );
  assert.equal(both.messages[1]?.latest_reply, "1793725200.000000");
});

test("who the person is comes from their profile, and their workspace from a channel's link at Slack's own address", async () => {
  const noId = altered(t.profile, (answer, call) =>
    call.args.user_id === undefined
      ? edited("result", (words) => words.replace(/^User ID: [^\n]+\n/, ""))(answer)
      : answer,
  );
  await assert.rejects(openSlack(connection, via(noId)), ServerUnreadable);
  for (const link of ["http://ferrowick-example.slack.com", "https://slack.evil.example", ""])
    await assert.rejects(
      openSlack(
        connection,
        via(
          altered(
            t.search,
            edited("results", (words) => words.replace(/https:\/\/[a-z0-9-]+\.slack\.com/, link)),
          ),
        ),
      ),
    );
});

test("a failed tool reads as deleted only when Slack's code says so", async () => {
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
  await assert.rejects(
    api("users.profile.get", { user: "U0FWAMARA1" }),
    (error) => error instanceof SlackError && error.code === "failed",
  );
});

test("the read side refuses a post before anything is sent", async () => {
  let calls = 0;
  const api = slackServerReads({
    read: async () => {
      calls += 1;
      return json({});
    },
  });
  await assert.rejects(api("chat.postMessage" as never, { channel: weather, text: "hi" }));
  await assert.rejects(
    slackServerApi({ read: async () => json({}) })("chat.postMessage", { channel: weather }),
  );
  assert.equal(calls, 0);
});

test("a post's ts is the one Slack's answer gives for the channel posted to, never a link the text holds", async () => {
  const post = (answer: unknown) =>
    slackServerApi({ read: async () => json({}), write: async () => json(answer) })(
      "chat.postMessage",
      { channel: weather, text: "see https://x.slack.com/archives/C0OTHER1/p1700000000000001" },
    );
  assert.deepEqual(
    await post({
      message_link: `https://x.slack.com/archives/${weather}/p1794119699753869`,
      message_context: { message_ts: "1794119699.753869", channel_id: weather },
    }),
    { ok: true, channel: weather, ts: "1794119699.753869" },
  );
  assert.deepEqual(
    await post({
      text: "see https://x.slack.com/archives/C0OTHER1/p1700000000000001",
      message_link: "https://x.slack.com/archives/C0OTHER1/p1700000000000001",
      message_context: { message_ts: "1700000000.000001", channel_id: "C0OTHER1" },
    }),
    { ok: true, channel: weather },
  );
});

const [channelsPick] = slackServer.picks ?? [];

test("the channel picker reads every page once, and stops on one the server repeats or can't give", async () => {
  let calls = 0;
  const paged: ToolCaller = async (call) => {
    calls += 1;
    const at = Number(call.args.cursor ?? 0);
    const next = String(at >= 2 ? 1 : at + 1);
    return json({
      result: `## My Channels (showing 1, more results available)\n\n### #c-${at}\n- **ID:** C${at}A\n- **Type:** Public Channel\n- **Archived:** ${at === 1 ? "Yes" : "No"}\n\n---\nPagination: More results available. Use cursor: "${next}"\n`,
    });
  };
  const listed = await channelsPick?.list(paged, "", connection);
  assert.deepEqual(
    listed?.choices.map((each) => each.value),
    ["C0A", "C2A"],
    "archived ones aren't offered",
  );
  assert.equal(calls, 3, "it stops at the cursor it had read before");
  const broken: ToolCaller = async () =>
    json({ result: "## My Channels (showing 1 of 1 total)\n\n### #no-id\n- **Archived:** No\n" });
  await assert.rejects(
    channelsPick?.list(broken, "", connection) ?? Promise.resolve(),
    ServerUnreadable,
  );
});
