import assert from "node:assert/strict";
import { test } from "node:test";
import { slackRecognizer } from "./references.ts";

const recognize = slackRecognizer({ workspaceUrl: "https://ferrowick-example.slack.com/" });
const archive = "https://ferrowick-example.slack.com/archives/C0FW1WEATHR";

test("a link to a message in the workspace references it, and a reply's link its message", () => {
  assert.deepEqual(
    recognize(
      `Decided here (${archive}/p1788444000000100). Also ${archive}/p1788445500000100?thread_ts=1788444000.000100&cid=C0FW1WEATHR, and ${archive}/p1788344100000100.`,
    ),
    ["slack:C0FW1WEATHR-1788444000.000100", "slack:C0FW1WEATHR-1788344100.000100"],
  );
});

test("a link to another workspace, a channel or anything else, and a bare key, reference nothing", () => {
  for (const text of [
    "https://other-example.slack.com/archives/C0FW1WEATHR/p1788444000000100",
    `${archive} and ${archive}/p178844`,
    "C0FW1WEATHR-1788444000.000100 SYN-54",
    "http://ferrowick-example.slack.com/archives/C0FW1WEATHR/p1788444000000100",
  ])
    assert.deepEqual(recognize(text), [], text);
  assert.deepEqual(slackRecognizer({ workspaceUrl: "not a url" })(archive), []);
});

test("a link longer than any Slack makes is skipped, however it is padded", () => {
  const padded = `${archive}/p1788444000000100${".".repeat(40_000)}x`;
  assert.deepEqual(recognize(padded), []);
  assert.deepEqual(recognize(`https://ferrowick-example.slack.com/${"/".repeat(40_000)}`), []);
});
