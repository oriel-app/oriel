// The message a link into Slack points at (OA-49): a reply's link names its
// conversation's message.
import assert from "node:assert/strict";
import { test } from "node:test";
import { slackLinked } from "./attrs.ts";

const archive = "https://example.slack.com/archives/C0FW1WEATHR";

test("a message's link names it, and a reply's link names its message", () => {
  assert.equal(
    slackLinked(new URL(`${archive}/p1788444000000100`)),
    "C0FW1WEATHR-1788444000.000100",
  );
  assert.equal(
    slackLinked(
      new URL(`${archive}/p1788445500000100?thread_ts=1788444000.000100&cid=C0FW1WEATHR`),
    ),
    "C0FW1WEATHR-1788444000.000100",
  );
  // A private channel's ID starts with G.
  assert.equal(
    slackLinked(new URL("https://example.slack.com/archives/G0PRIVATE01/p1788444000000100")),
    "G0PRIVATE01-1788444000.000100",
  );
});

test("a link that isn't to a message names nothing, and a malformed thread_ts is ignored", () => {
  for (const link of [
    archive,
    `${archive}/p178844`,
    "https://example.slack.com/team/U0FWINES01",
    "https://example.slack.com/archives/D0DIRECT01/p1788444000000100",
  ])
    assert.equal(slackLinked(new URL(link)), null, link);
  assert.equal(
    slackLinked(new URL(`${archive}/p1788445500000100?thread_ts=../../x`)),
    "C0FW1WEATHR-1788445500.000100",
  );
});
