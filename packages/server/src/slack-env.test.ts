import assert from "node:assert/strict";
import { test } from "node:test";
import { slackEnv } from "./env.ts";

test("live Slack reads with the first user token, and no message carries a value", () => {
  assert.deepEqual(slackEnv("SLACK_USER_TOKENS=xoxp-first xoxp-second\nGH_TOKEN=not-read"), {
    token: "xoxp-first",
  });
  for (const file of [null, "", "SLACK_USER_TOKENS=", "SLACK_USER_TOKENS=xoxb-secret-bot"]) {
    const env = slackEnv(file);
    assert.ok("problem" in env);
    assert.doesNotMatch(env.problem, /secret|xoxb/);
  }
});
