import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseSlackFixture } from "../../packages/slack/src/fixture.ts";
import { loadSlackFixture, slackFixture, slackFixtureFile } from "./slack.ts";

test("fixtures/slack/workspace.json is what the generator writes", () => {
  assert.equal(
    readFileSync(slackFixtureFile, "utf8"),
    `${JSON.stringify(slackFixture(), null, 2)}\n`,
  );
  assert.doesNotThrow(() => loadSlackFixture());
});

test("every free-text field has an injection: a message, a reply and a person's name", () => {
  const fixture = loadSlackFixture();
  const injection = /ignore (previous|your) instructions/i;
  const [weather] = fixture.channels;
  assert.ok(weather?.messages.some((m) => !m.subtype && injection.test(m.text)));
  assert.ok(weather?.messages.some((m) => m.replies?.some((r) => injection.test(r.text))));
  assert.ok(fixture.users.some((u) => injection.test(u.real_name)));
});

test("a ts used twice, a reply before its message, or a picked channel that isn't there is refused", () => {
  const base = slackFixture();
  const [channel] = base.channels;
  assert.ok(channel);
  const [first, second] = channel.messages;
  assert.ok(first && second);
  const broken = [
    { ...base, picked: ["C0NOTHERE1"] },
    { ...base, channels: [{ ...channel, messages: [first, { ...second, ts: first.ts }] }] },
    {
      ...base,
      channels: [{ ...channel, messages: [{ ...second, replies: [{ ...first, ts: first.ts }] }] }],
    },
  ];
  for (const fixture of broken) assert.equal(parseSlackFixture(fixture).ok, false);
});
