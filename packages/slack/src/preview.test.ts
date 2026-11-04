// What the agent reads to draft a Slack connection's channels (decision
// 0051), over the fixture's Web API: every public channel, most lately
// active first, by the day it was last active.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type Instant, OptionsUnfit, type ToOpen, type Ulid } from "@oriel/core";
import { slackDeclaredFixture } from "./declared-fixture.ts";

const connection: ToOpen = {
  id: "01JC0NNECT10N0000000000000" as Ulid,
  number: 1,
  prefix: "slack",
  identity: "https://ferrowick-example.slack.com/",
  options: { channels: ["weather-disruptions", "launch-room"] },
  secret: "xoxp-fixture",
};
const via = {
  kept: true,
  log: () => {},
  now: (): Instant => "2026-10-01T12:00:00.000Z" as Instant,
};

test("the preview lists each public channel by when it was last active", async () => {
  const preview = slackDeclaredFixture.preview;
  assert.ok(preview);
  assert.deepEqual(await preview(connection, via), [
    {
      name: "Public channels",
      columns: ["Channel", "Last active"],
      rows: [
        ["weather-disruptions", "2026-09-27"],
        ["random", "2026-09-05"],
      ],
    },
  ]);
});

test("a channel the options name that Slack no longer has doesn't fit them", async () => {
  await assert.rejects(
    slackDeclaredFixture.open(connection, via),
    (error) => error instanceof OptionsUnfit && /#launch-room/.test(error.message),
  );
});
