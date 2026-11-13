import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type ItemId,
  itemId,
  SourceRefused,
  type ToolCall,
  type SourceWriter,
  ulid,
  type WriteRequest,
} from "@oriel/core";
import { weather } from "../../../scripts/fixtures/slack.ts";
import { fixtureApi, loadSlackFixture } from "./fixture.ts";
import { slackServer, slackServerApi, slackTools as t } from "./slack-mcp.ts";
import { slackStandIn, standInCaller } from "./slack-standin.ts";
import { slackWriter, slackWriterOf, writeApi } from "./writer.ts";

// Stands in for packages/changeset, the only place that mints approvals; scripts/check-repo.ts
// allows this cast only in an adapter's writer test.
const approve = (request: WriteRequest<"slack">) =>
  request as Parameters<SourceWriter<"slack">["apply"]>[0];

const fixture = loadSlackFixture();
const [amara, , , dara] = fixture.users.map((user) => user.id);
const random = "C0FW2RANDOM";
const own = "1789045200.000100";
const question = "1790071200.000100";
const decision = "1788444000.000100";
const conversation = (ts: string): ItemId<"slack"> => itemId("slack", `${weather}-${ts}`);

let seq = 0;
const request = (op: string, target: ItemId<"slack"> | null, args: unknown) =>
  approve({
    mutationId: ulid(0, new Uint8Array(10).fill(seq++ % 256)),
    op,
    target,
    expectedStableId: target === null ? null : target.slice("slack:".length),
    args,
  });

function setup(channels: readonly string[] = [weather]) {
  const workspace = fixtureApi(fixture);
  const writer = slackWriter({
    api: writeApi(workspace.fetch),
    channels,
    log: () => {},
  });
  const writes = () =>
    workspace.calls.filter((c) => c.method === "chat.postMessage" || c.method === "chat.delete");
  return { workspace, writer, writes };
}

const refused = (error: unknown) => error instanceof SourceRefused && !error.sent;

test("a post goes in a read channel escaped, so it mentions and links nothing", async () => {
  const { writer, writes } = setup();
  const text = "SYN-47 is ready to pick up <!channel> & thanks";
  const result = await writer.apply(
    request("postMessage", null, { channel: weather, text, author: amara }),
  );
  assert.deepEqual(writes(), [
    {
      method: "chat.postMessage",
      params: {
        channel: weather,
        text: "SYN-47 is ready to pick up &lt;!channel&gt; &amp; thanks",
        mrkdwn: "false",
      },
    },
  ]);
  assert.equal(result.after.description, text);
});

test("nothing is sent to a channel the server doesn't read, or as anyone but the token's person", async () => {
  const { writer, writes } = setup();
  await assert.rejects(
    writer.apply(request("postMessage", null, { channel: random, text: "Hi", author: amara })),
    refused,
  );
  await assert.rejects(
    writer.apply(request("postMessage", null, { channel: weather, text: "Hi", author: dara })),
    refused,
  );
  await assert.rejects(
    writer.apply(request("reply", conversation(question), { text: "Hi", author: dara })),
    refused,
  );
  const narrow = setup([random]);
  await assert.rejects(
    narrow.writer.apply(request("reply", conversation(question), { text: "Hi", author: amara })),
    refused,
  );
  assert.equal(await narrow.writer.current(conversation(question), ["summary"]), "gone");
  assert.deepEqual([...writes(), ...narrow.writes()], []);
});

test("a reply goes in the conversation, and its undo's fields say whether anyone added to it", async () => {
  const { writer, workspace } = setup();
  const id = conversation(question);
  const result = await writer.apply(
    request("reply", id, { text: "Picked up: on it.", author: amara }),
  );
  assert.equal(result.item.id, id);
  const field = Object.keys(result.before).find((name) => name.startsWith("reply:"));
  assert.ok(field);
  assert.deepEqual(result.before, { [field]: null, replies: 2 });
  assert.deepEqual(result.after, {
    [field]: "Picked up: on it.",
    replies: 3,
    updated: result.after.updated,
  });
  workspace.replyAs(dara ?? "", weather, question, "Thanks!");
  assert.deepEqual(await writer.current(id, [field, "replies"]), {
    [field]: "Picked up: on it.",
    replies: 4,
  });
  workspace.edit(weather, field.slice("reply:".length), "Picked up.", amara ?? "");
  assert.deepEqual(await writer.current(id, [field]), { [field]: "Picked up." });
});

test("only the person's own message is deleted, and only while nobody has replied to it", async () => {
  const { writer, workspace, writes } = setup();
  await assert.rejects(writer.apply(request("deleteMessage", conversation(decision), {})), refused);
  const posted = await writer.apply(
    request("postMessage", null, { channel: weather, text: "Ready.", author: amara }),
  );
  const [, ts = ""] = posted.item.stableId.split("-");
  workspace.replyAs(dara ?? "", weather, ts, "Which one?");
  await assert.rejects(writer.apply(request("deleteMessage", posted.item.id, {})), refused);
  const deleted = await writer.apply(request("deleteMessage", conversation(own), {}));
  assert.deepEqual(deleted.after, {});
  assert.deepEqual(Object.keys(deleted.before), ["summary", "description"]);
  assert.equal(await writer.current(conversation(own), ["summary"]), "gone");
  assert.deepEqual(
    writes().map((c) => c.method),
    ["chat.postMessage", "chat.delete"],
  );
});

test("a reply it posted is deleted; one someone else posted isn't", async () => {
  const { writer } = setup();
  const id = conversation(question);
  const [theirs] = fixture.channels[0]?.messages.find((m) => m.ts === question)?.replies ?? [];
  assert.ok(theirs);
  await assert.rejects(writer.apply(request("deleteReply", id, { ts: theirs.ts })), refused);
  const posted = await writer.apply(request("reply", id, { text: "On it.", author: amara }));
  const ts = Object.keys(posted.after)
    .find((name) => name.startsWith("reply:"))
    ?.slice("reply:".length);
  assert.ok(ts);
  const deleted = await writer.apply(request("deleteReply", id, { ts }));
  assert.deepEqual(deleted.before[`reply:${ts}`], "On it.");
  assert.equal(deleted.after[`reply:${ts}`], null);
  assert.equal(deleted.after.replies, 2);
});

test("through Slack's server, a post and a reply are each one write call, escaped, read back by the read tools", async () => {
  const tools = standInCaller(slackStandIn(fixture));
  const written: ToolCall[] = [];
  const read: string[] = [];
  const writer = slackWriterOf(
    {
      channels: fixture.picked,
      through: {
        read: async (call) => {
          read.push(call.tool);
          return tools(call);
        },
        write: async (call) => {
          written.push({ tool: call.tool, args: { ...call.args } });
          return tools(call);
        },
      },
    },
    () => {},
  );
  const author = fixture.users[0]?.id ?? "";
  const posted = await writer.apply(
    request("postMessage", null, {
      channel: weather,
      text: "Ready <!channel> & read [the runbook](https://x.example) **now**",
      author,
    }),
  );
  assert.deepEqual(written, [
    {
      tool: t.send,
      args: {
        channel_id: weather,
        message:
          "Ready &lt;\\!channel&gt; &amp; read \\[the runbook\\]\\(https://x.example\\) \\*\\*now\\*\\*",
      },
    },
  ]);
  assert.match(posted.item.stableId, new RegExp(`^${weather}-[0-9]{10}\\.[0-9]{6}$`));
  assert.equal(
    posted.after.description,
    "Ready <!channel> & read [the runbook](https://x.example) **now**",
  );

  const question = itemId("slack", `${weather}-1790071200.000100`);
  const replied = await writer.apply(request("reply", question, { text: "On it", author }));
  assert.deepEqual(written.at(-1), {
    tool: t.send,
    args: { channel_id: weather, message: "On it", thread_ts: "1790071200.000100" },
  });
  assert.equal(replied.after.replies, (replied.before.replies as number) + 1);
  assert.equal(written.length, 2, "nothing else wrote");
  assert.ok(read.every((tool) => slackServer.reads.includes(tool)));
});

test("through Slack's server, undoing a post sends nothing: it has no tool to delete one", async () => {
  const tools = standInCaller(slackStandIn(fixture));
  const written: ToolCall[] = [];
  const writer = slackWriter({
    api: slackServerApi({
      read: tools,
      write: async (call) => {
        written.push(call);
        return tools(call);
      },
    }),
    channels: fixture.picked,
    log: () => {},
    whole: true,
  });
  const author = fixture.users[0]?.id ?? "";
  const posted = await writer.apply(
    request("postMessage", null, { channel: weather, text: "Mine", author }),
  );
  await assert.rejects(writer.apply(request("deleteMessage", posted.item.id, {})), refused);
  assert.equal(written.length, 1, "only the post went out");
});

test("a post the server failed without saying why may have landed: it's no refusal", async () => {
  const tools = standInCaller(slackStandIn(fixture));
  const writer = slackWriter({
    api: slackServerApi({
      read: tools,
      write: async () => ({ content: [{ type: "text", text: "Oops" }], isError: true }),
    }),
    channels: fixture.picked,
    log: () => {},
  });
  const error = await writer
    .apply(
      request("postMessage", null, {
        channel: weather,
        text: "Mine",
        author: fixture.users[0]?.id ?? "",
      }),
    )
    .catch((caught: unknown) => caught);
  assert.ok(error instanceof Error && !(error instanceof SourceRefused));
  const refusing = slackWriter({
    api: slackServerApi({
      read: tools,
      write: async () => ({
        content: [{ type: "text", text: "Slack refused it: is_archived" }],
        isError: true,
      }),
    }),
    channels: fixture.picked,
    log: () => {},
  });
  await assert.rejects(
    refusing.apply(
      request("postMessage", null, {
        channel: weather,
        text: "Mine",
        author: fixture.users[0]?.id ?? "",
      }),
    ),
    SourceRefused,
  );
});
