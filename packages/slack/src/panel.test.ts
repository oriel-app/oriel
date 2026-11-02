// What the Slack fixture marks, as the panel shows it (OA-94): mentions set
// apart, a reply also sent to the channel, an edit, and a message that is a
// file with no text, each distinct from plain text.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ItemId, PanelBlock, PanelMessage } from "@oriel/core";
import { loadSlackFixture, weather } from "../../../scripts/fixtures/slack.ts";
import { slackPanel } from "./attrs.ts";
import { fixtureApi } from "./fixture.ts";
import { slackSource } from "./source.ts";

const fixture = loadSlackFixture();
const id = (ts: string): ItemId<"slack"> => `slack:${weather}-${ts}`;
const sms = "1788782400.000100";

async function panelOf(ts: string, change?: (api: ReturnType<typeof fixtureApi>) => void) {
  const api = fixtureApi(fixture);
  change?.(api);
  const source = slackSource({
    api: api.api,
    workspaceUrl: fixture.team.url,
    channels: fixture.picked,
    log: () => {},
  });
  const [read] = await source.read([id(ts)]);
  assert.ok(read?.status === "ok");
  const view = slackPanel(read.content);
  assert.ok(view);
  return view.blocks.flatMap((block: PanelBlock) =>
    block.kind === "messages" ? block.messages : [],
  );
}

const mentions = (message: PanelMessage | undefined, kind: "mention" | "channel" = "mention") =>
  (message?.spans ?? []).flatMap((span) => (span.kind === kind ? [span.text] : []));

test("mentions of people and groups are set apart, by name where Oriel knows them", async () => {
  const [root, support, final] = await panelOf(sms);
  assert.deepEqual(mentions(root), ["@here", "@ops-leads"]);
  assert.deepEqual(mentions(support), ["@Dara Nikolaidis"]);
  // The text as written is the same, mentions and all.
  assert.equal(support?.text, "Support is happy with it. cc @Dara Nikolaidis");
  assert.equal(
    support?.spans?.map((span) => ("text" in span ? span.text : "")).join(""),
    support?.text,
  );
  // Text that names no one has no spans to set apart.
  assert.equal(final?.spans, undefined);
  const [unknown] = await panelOf("1789982100.000100");
  assert.deepEqual(mentions(unknown), ["@U0FWGONE01"]);
});

test("a reply also sent to the channel says so", async () => {
  const replies = (await panelOf(sms)).slice(1);
  assert.deepEqual(
    replies.map((reply) => reply.labels ?? []),
    [[], ["Also sent to #weather-disruptions"]],
  );
});

test("an edited message or reply says when it was edited; others don't", async () => {
  const [flag] = await panelOf("1788884400.000100");
  assert.equal(flag?.edited, "2026-09-09T09:00:00.000Z");
  const plain = await panelOf(sms);
  assert.ok(plain.every((message) => message.edited === undefined));
  const [, edited] = await panelOf(sms, (api) =>
    api.edit(weather, "1788783600.000100", "Support is happy with it.", "U0FWINES01"),
  );
  assert.equal(typeof edited?.edited, "string");
});

test("a file with no text is its file, apart from the text, which is empty", async () => {
  const [file] = await panelOf("1789290600.000100");
  assert.deepEqual(file?.files, ["Car deck at 06:40, MV Corran"]);
  assert.equal(file?.text, "");
});

test("a channel mentioned without its name is named where the user picked it", async () => {
  const api = fixtureApi(fixture);
  const ts = api.replyAs(
    "U0FWINES01",
    weather,
    sms,
    `See <#${weather}> and <#C0FW2RANDOM> and <#C0FW9OTHER|elsewhere>`,
  );
  assert.ok(ts);
  const source = slackSource({
    api: api.api,
    workspaceUrl: fixture.team.url,
    channels: fixture.picked,
    log: () => {},
  });
  const [read] = await source.read([id(sms)]);
  assert.ok(read?.status === "ok");
  const messages = slackPanel(read.content)?.blocks.flatMap((block) =>
    block.kind === "messages" ? block.messages : [],
  );
  // A channel isn't a mention, which names people.
  assert.deepEqual(mentions(messages?.at(-1)), []);
  // A channel nobody picked stays its ID: Oriel never asks about it.
  assert.deepEqual(mentions(messages?.at(-1), "channel"), [
    "#weather-disruptions",
    "#C0FW2RANDOM",
    "#elsewhere",
  ]);
  assert.ok(api.calls.every((call) => call.params.channel !== "C0FW2RANDOM"));
});
