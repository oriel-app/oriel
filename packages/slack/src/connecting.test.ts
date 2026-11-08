import assert from "node:assert/strict";
import { test } from "node:test";
import { slackLive } from "./connecting.ts";

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
