import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type ItemId,
  itemId,
  SourceRefused,
  type SourceWriter,
  ulid,
  type WriteRequest,
} from "@oriel/core";
import { loadSlackFixture, weather } from "../../../scripts/fixtures/slack.ts";
import { fixtureApi } from "./fixture.ts";
import { slackSource } from "./source.ts";
import { slackWriter, writeApi } from "./writer.ts";

// Stands in for packages/changeset, the only place that mints approvals in
// production. These tests cover the Web API mapping, not the approval gate.
// scripts/check-repo.ts allows this cast only in an adapter's writer test.
const approve = (request: WriteRequest<"slack">) =>
  request as Parameters<SourceWriter<"slack">["apply"]>[0];

const fixture = loadSlackFixture();
const [amara, , , dara] = fixture.users.map((user) => user.id);
const random = "C0FW2RANDOM";
// In the picked channel: Amara's own message with no replies, her question
// with two, and Dara's decision.
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
    api: writeApi({ credential: { headers: async () => ({}) }, fetch: workspace.fetch }),
    channels,
    log: () => {},
  });
  const writes = () =>
    workspace.calls.filter((c) => c.method === "chat.postMessage" || c.method === "chat.delete");
  return { workspace, writer, writes };
}

const refused = (sent: boolean, message: RegExp) => (error: unknown) =>
  error instanceof SourceRefused && error.sent === sent && message.test(error.message);

test("a post goes in a read channel as the token's person, escaped, and reads back as written", async () => {
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
  const key = result.item.stableId;
  assert.equal(result.item.id, `slack:${key}`);
  assert.match(key, /^C0FW1WEATHR-\d{10}\.000100$/);
  assert.deepEqual(result.before, {});
  assert.deepEqual(result.after, {
    summary: `Amara Okafor: ${text}`,
    description: text,
    updated: result.after.updated,
  });
  assert.deepEqual(await writer.current(result.item.id, ["replies", "description"]), {
    replies: 0,
    description: text,
  });
});

test("nothing is sent to a channel the server doesn't read, or as anyone but the token's person", async () => {
  const { writer, writes } = setup();
  await assert.rejects(
    writer.apply(request("postMessage", null, { channel: random, text: "Hi", author: amara })),
    refused(false, /doesn't read that channel/),
  );
  await assert.rejects(
    writer.apply(request("postMessage", null, { channel: weather, text: "Hi", author: dara })),
    refused(false, /reads Slack as someone else now/),
  );
  await assert.rejects(
    writer.apply(request("reply", conversation(question), { text: "Hi", author: dara })),
    refused(false, /someone else/),
  );
  // A conversation in a channel it doesn't read, even one it once did.
  const narrow = setup([random]);
  await assert.rejects(
    narrow.writer.apply(request("reply", conversation(question), { text: "Hi", author: amara })),
    refused(false, /doesn't read that channel/),
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
  // Someone replies after it: the count moves, which a revert compares.
  workspace.replyAs(dara ?? "", weather, question, "Thanks!");
  assert.deepEqual(await writer.current(id, [field, "replies"]), {
    [field]: "Picked up: on it.",
    replies: 4,
  });
  // An edit changes its text.
  workspace.edit(weather, field.slice("reply:".length), "Picked up.", amara ?? "");
  assert.deepEqual(await writer.current(id, [field]), { [field]: "Picked up." });
});

test("only the person's own message is deleted, and only while nobody has replied to it", async () => {
  const { writer, workspace, writes } = setup();
  await assert.rejects(
    writer.apply(request("deleteMessage", conversation(decision), {})),
    refused(false, /isn't the posting person's own/),
  );
  const posted = await writer.apply(
    request("postMessage", null, { channel: weather, text: "Ready.", author: amara }),
  );
  const [, ts = ""] = posted.item.stableId.split("-");
  workspace.replyAs(dara ?? "", weather, ts, "Which one?");
  await assert.rejects(
    writer.apply(request("deleteMessage", posted.item.id, {})),
    refused(false, /has replies now/),
  );
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
  await assert.rejects(
    writer.apply(request("deleteReply", id, { ts: theirs.ts })),
    refused(false, /isn't the posting person's own/),
  );
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

test("Slack refusing a write made no change, and says why in words", async () => {
  const workspace = fixtureApi(fixture);
  const writer = slackWriter({
    api: writeApi({
      credential: { headers: async () => ({}) },
      fetch: async (input, init) =>
        String(input).endsWith("/chat.postMessage")
          ? Response.json({ ok: false, error: "missing_scope" })
          : workspace.fetch(input, init),
    }),
    channels: [weather],
    log: () => {},
  });
  await assert.rejects(
    writer.apply(request("postMessage", null, { channel: weather, text: "Hi", author: amara })),
    refused(true, /needs the chat:write scope/),
  );
});

test("a conversation reads as the source reads it: mentions named, as the window titles it", async () => {
  const { writer } = setup();
  // Bastian's question, which mentions someone.
  const id = conversation("1789982100.000100");
  const [read] = await slackSource({
    api: fixtureApi(fixture).api,
    workspaceUrl: fixture.team.url,
    channels: [weather],
    log: () => {},
  }).read([id]);
  assert.ok(read?.status === "ok");
  assert.match(read.content.body, /^@/);
  assert.deepEqual(await writer.current(id, ["summary", "description", "replies"]), {
    summary: read.content.title,
    description: read.content.body,
    replies: read.content.replies.length,
  });
});

test("the writer names people and the channels the server reads", async () => {
  const { writer } = setup();
  assert.equal(await writer.name?.(amara ?? ""), "Amara Okafor");
  assert.equal(await writer.name?.(weather), "weather-disruptions");
  assert.equal(await writer.name?.(random), null);
  assert.equal(await writer.name?.("UNOBODY000"), null);
});

test("the fixture's workspace is written in its own copy, never the fixture", async () => {
  const before = JSON.stringify(fixture);
  const { writer, workspace } = setup();
  await writer.apply(
    request("postMessage", null, { channel: weather, text: "Ready.", author: amara }),
  );
  assert.equal(JSON.stringify(fixture), before);
  const history = (await workspace.api("conversations.history", { channel: weather })) as {
    messages: { text: string }[];
  };
  assert.equal(history.messages[0]?.text, "Ready.");
});
