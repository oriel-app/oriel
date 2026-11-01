import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type ItemId,
  type LineContext,
  type NamespaceHost,
  type NamespaceWrite,
  type Subject,
} from "@oriel/core";
import { slackNamespace } from "./namespace.ts";
import { slackSpecs } from "./specs.ts";

const weather = "C0FW1WEATHR";
const conversation: ItemId = `slack:${weather}-1790071200.000100`;
const names: Record<string, string> = {
  U0FWAMARA1: "Amara Okafor",
  [weather]: "weather-disruptions",
};
const context = (subject: Subject = null, before = {}): LineContext => ({
  subject,
  before,
  name: async (id) => names[id] ?? null,
  title: async () => null,
});
const spec = (op: string) => {
  const found = slackSpecs.ops[op];
  assert.ok(found, op);
  return found;
};
const about: Subject = {
  kind: "item",
  id: conversation,
  title: "Amara Okafor: Status of SYN-47 (the disruption reason in plain words)?",
};

test("a post's line names the channel and who posts, and shows the text as written", async () => {
  const args = {
    channel: weather,
    text: "SYN-47 is ready to pick up.\n\nAsk me.",
    author: "U0FWAMARA1",
  };
  const post = spec("postMessage");
  assert.equal(
    await post.describe(args, context()),
    "Post in #weather-disruptions as Amara Okafor. Everyone there can read it once it's posted; a revert deletes it.",
  );
  assert.deepEqual(post.after(args), { description: args.text });
  assert.deepEqual([post.creates, post.makes, post.idempotent], [true, "message", false]);
  assert.deepEqual(
    post.undo(args, { item: { id: conversation, stableId: "" }, before: {}, after: {} }),
    {
      op: "deleteMessage",
      args: {},
    },
  );
  // Someone Oriel can't name is said so, never left out.
  assert.match(
    await post.describe({ ...args, author: "UNOBODY0001" }, context()),
    /as a person Oriel can't name/,
  );
});

test("a reply's line names the conversation, its channel and who posts", async () => {
  const reply = spec("reply");
  const args = { text: "On it.", author: "U0FWAMARA1" };
  assert.equal(
    await reply.describe(args, context(about)),
    "Reply in the conversation “Amara Okafor: Status of SYN-47 (the disruption reason in plain words)?” in #weather-disruptions as Amara Okafor. Everyone there can read it once it's posted; a revert deletes it.",
  );
  assert.deepEqual(reply.after(args), { "reply:new": "On it." });
  const applied = {
    item: { id: conversation, stableId: "" },
    before: { "reply:1790500000.000100": null, replies: 2 },
    after: { "reply:1790500000.000100": "On it.", replies: 3 },
  };
  assert.deepEqual(reply.undo(args, applied), {
    op: "deleteReply",
    args: { ts: "1790500000.000100" },
  });
  assert.deepEqual(reply.undo(args, { ...applied, after: {} }), {
    refused: "Slack didn't report which reply it posted",
  });
});

test("a revert's lines say people may already have seen what it deletes", async () => {
  assert.equal(
    await spec("deleteMessage").describe({}, context(about)),
    "Delete the message “Amara Okafor: Status of SYN-47 (the disruption reason in plain words)?” from #weather-disruptions. People there may already have seen it.",
  );
  assert.equal(
    await spec("deleteReply").describe({ ts: "1790500000.000100" }, context(about)),
    "Delete the reply Oriel posted in the conversation “Amara Okafor: Status of SYN-47 (the disruption reason in plain words)?” in #weather-disruptions. People there may already have seen it.",
  );
  for (const op of ["deleteMessage", "deleteReply"])
    assert.ok(
      "refused" in
        spec(op).undo(
          { ts: "1790500000.000100" },
          { item: { id: conversation, stableId: "" }, before: {}, after: {} },
        ),
    );
});

test("a message's arguments are checked: text a person can review, IDs of the right shape", () => {
  const ok = { channel: weather, text: "Ready.", author: "U0FWAMARA1" };
  assert.ok(spec("postMessage").args(ok).ok);
  for (const bad of [
    { ...ok, text: "  " },
    { ...ok, text: "x".repeat(4_001) },
    { ...ok, channel: "#weather-disruptions" },
    { ...ok, author: "Amara" },
  ])
    assert.equal(spec("postMessage").args(bad).ok, false, JSON.stringify(bad).slice(0, 80));
  assert.equal(spec("deleteReply").args({ ts: "../x" }).ok, false);
});

// The region's IDs, as a namespace's host sees them.
const host = (ids: readonly string[]): NamespaceHost => ({
  has: (id): id is ItemId => ids.includes(id),
  created: new Map(),
  read: async () => [],
});
const writes = (context: Parameters<typeof slackNamespace>[0]) =>
  new Map(
    slackNamespace(context)
      .fns({ ids: [conversation], anchor: null })
      .flatMap((fn) => (fn.kind === "write" ? [[fn.name, fn] as const] : [])),
  );

test("the namespace posts as the context's person, beside the region's conversations only", () => {
  const offered = writes({ channels: [weather], author: "U0FWAMARA1" });
  const post = offered.get("postMessage") as NamespaceWrite;
  const reply = offered.get("reply") as NamespaceWrite;
  const region = host([conversation, "jira:SYN-47"]);
  assert.deepEqual(post.build([conversation, "Ready."], region), {
    target: null,
    args: { channel: weather, text: "Ready.", author: "U0FWAMARA1" },
  });
  assert.deepEqual(reply.build([conversation, "On it."], region), {
    target: conversation,
    args: { text: "On it.", author: "U0FWAMARA1" },
  });
  const other = `slack:${weather}-1788444000.000100`;
  assert.throws(() => post.build([other, "Hi"], region), /isn't in this region/);
  assert.throws(() => reply.build(["jira:SYN-47", "Hi"], region), /isn't a Slack conversation/);
  // One reply a conversation in a run: a second would read as an edit.
  assert.throws(() => reply.build([conversation, "And more."], region), /has a reply in this run/);
  // A channel the server no longer reads.
  const elsewhere = writes({ channels: ["C0FW2RANDOM"], author: "U0FWAMARA1" });
  assert.throws(
    () => (elsewhere.get("reply") as NamespaceWrite).build([conversation, "Hi"], region),
    /doesn't read C0FW1WEATHR/,
  );
});

test("with Slack not connected, the namespace offers nothing and declares nothing", () => {
  const spec = slackNamespace(undefined);
  assert.deepEqual(spec.fns({ ids: [conversation], anchor: null }), []);
  assert.deepEqual(spec.types({ ids: [conversation], anchor: null }), []);
});
