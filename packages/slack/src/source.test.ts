import assert from "node:assert/strict";
import { test } from "node:test";
import type { ItemId } from "@oriel/core";
import { weather } from "../../../scripts/fixtures/slack.ts";
import type { SlackRecord } from "./attrs.ts";
import { type FixtureApiOptions, fixtureApi, loadSlackFixture } from "./fixture.ts";
import { slackSource } from "./source.ts";

const fixture = loadSlackFixture();
const url = fixture.team.url;

function sourceFor(options: FixtureApiOptions & { channels?: string[] } = {}) {
  const { api, calls } = fixtureApi(fixture, options);
  const source = slackSource({
    api,
    workspaceUrl: url,
    channels: options.channels ?? fixture.picked,
    log: () => {},
  });
  return { source, calls };
}

const id = (ts: string): ItemId<"slack"> => `slack:${weather}-${ts}`;
const decision = "1788444000.000100";

test("a channel that can't be read fails the sync, so nothing is marked gone", async () => {
  const { source } = sourceFor({ channels: ["C0NOTTHERE"] });
  await assert.rejects(async () => {
    for await (const page of source.sync(null)) assert.fail(`yielded ${page.records.length}`);
  });
});

test("a deleted message, a reply's ts, an unknown ts or another channel's message is gone, never a throw", async () => {
  const { source, calls } = sourceFor();
  const deleted = id("1788951600.000100");
  const reply = id("1788444600.000100");
  const unknown = id("1788444001.000100");
  const elsewhere: ItemId<"slack"> = "slack:C0FW2RANDOM-1788624000.000100";
  const results = await source.read([deleted, reply, unknown, elsewhere]);
  assert.deepEqual(results, [
    { id: deleted, status: "gone", reason: "deleted" },
    { id: reply, status: "gone", reason: "deleted" },
    { id: unknown, status: "gone", reason: "deleted" },
    { id: elsewhere, status: "gone", reason: "forbidden" },
  ]);
  assert.ok(calls.every((c) => c.params.channel !== "C0FW2RANDOM"));
});

test("past the cap, a channel lists its newest messages, and older ones read as forbidden, not fine", async () => {
  const { api } = fixtureApi(fixture, { pageSize: 2 });
  const source = slackSource({
    api,
    workspaceUrl: url,
    channels: fixture.picked,
    maxMessages: 5,
    log: () => {},
  });
  const records: SlackRecord[] = [];
  for await (const page of source.sync(null)) records.push(...page.records);
  assert.equal(records.length, 5);
  const newest = records[0]?.id;
  assert.ok(newest);
  const older = id(decision);
  assert.ok(!records.some((r) => r.id === older));
  const [listed, left] = await source.read([newest, older]);
  assert.equal(listed?.status, "ok");
  assert.deepEqual(left, { id: older, status: "gone", reason: "forbidden" });
});
