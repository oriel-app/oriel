import assert from "node:assert/strict";
import { test } from "node:test";
import { slackLive, slackOptions } from "./connecting.ts";

test("live Slack reads with the first user token, the channels a flag names", () => {
  assert.deepEqual(slackLive.env, ["SLACK_USER_TOKENS"]);
  assert.deepEqual(
    slackLive.connection({ SLACK_USER_TOKENS: "xoxp-first xoxp-second" }, { channels: "a, #b" }),
    { identity: "", options: { channels: ["a", "#b"] }, secret: "xoxp-first" },
  );
});

test("without a user token or a channel it isn't made, and no message carries a value", () => {
  const envs: Record<string, string>[] = [
    {},
    { SLACK_USER_TOKENS: "" },
    { SLACK_USER_TOKENS: "xoxb-secret-bot" },
  ];
  for (const env of envs) {
    const made = slackLive.connection(env, { channels: "a" });
    assert.ok("problem" in made);
    assert.doesNotMatch(JSON.stringify(made), /secret|xoxb/);
  }
  assert.ok("problem" in slackLive.connection({ SLACK_USER_TOKENS: "xoxp-first" }, {}));
});

test("a connection's options are its channels, one or more", () => {
  assert.equal(slackOptions({ channels: ["a"] }).ok, true);
  for (const channels of [[], [""], "a", ["x".repeat(101)]])
    assert.equal(slackOptions({ channels }).ok, false);
});
