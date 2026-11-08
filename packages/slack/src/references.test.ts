import assert from "node:assert/strict";
import { test } from "node:test";
import { slackRecognizer } from "./references.ts";

const recognize = slackRecognizer({ workspaceUrl: "https://ferrowick-example.slack.com/" });
const archive = "https://ferrowick-example.slack.com/archives/C0FW1WEATHR";

test("a link longer than any Slack makes is skipped, however it is padded", () => {
  const padded = `${archive}/p1788444000000100${".".repeat(40_000)}x`;
  assert.deepEqual(recognize(padded), []);
  assert.deepEqual(recognize(`https://ferrowick-example.slack.com/${"/".repeat(40_000)}`), []);
});
