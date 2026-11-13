import assert from "node:assert/strict";
import { test } from "node:test";
import type { ItemId, NamespaceHost, NamespaceWrite } from "@oriel/core";
import { slackNamespace } from "./namespace.ts";
import { slackSpecs } from "./specs.ts";

const weather = "C0FW1WEATHR";
const conversation: ItemId = `slack:${weather}-1790071200.000100`;
const spec = (op: string) => {
  const found = slackSpecs.ops[op];
  assert.ok(found, op);
  return found;
};

test("a reply's revert deletes the reply it posted, and only when Slack said which", () => {
  const reply = spec("reply");
  const args = { text: "On it.", author: "U0FWAMARA1" };
  const applied = {
    item: { id: conversation, stableId: "" },
    before: { "reply:1790500000.000100": null, replies: 2 },
    after: { "reply:1790500000.000100": "On it.", replies: 3 },
  };
  assert.deepEqual(reply.undo(args, applied), {
    op: "deleteReply",
    args: { ts: "1790500000.000100" },
  });
  assert.ok("refused" in reply.undo(args, { ...applied, after: {} }));
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
  assert.throws(() => post.build([other, "Hi"], region));
  assert.throws(() => reply.build(["jira:SYN-47", "Hi"], region));
  assert.throws(() => reply.build([conversation, "And more."], region));
  const elsewhere = writes({ channels: ["C0FW2RANDOM"], author: "U0FWAMARA1" });
  assert.throws(() =>
    (elsewhere.get("reply") as NamespaceWrite).build([conversation, "Hi"], region),
  );
});
