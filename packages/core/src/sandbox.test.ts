import assert from "node:assert/strict";
import { test } from "node:test";
import { guestMessage } from "./sandbox.ts";

test("each guest message kind parses", () => {
  const messages = [
    { kind: "read", id: 1, fn: "jira.listStories", args: [] },
    { kind: "write", fn: "jira.setEstimate", args: ["SYN-12", 3], ref: null },
    { kind: "write", fn: "jira.createStory", args: [{ summary: "x" }], ref: "new:1" },
    { kind: "log", text: "hello" },
    { kind: "done", value: { count: 2 } },
    { kind: "threw", message: "boom" },
  ];
  for (const message of messages)
    assert.equal(guestMessage(message).ok, true, JSON.stringify(message));
});

test("malformed or unknown guest messages are rejected", () => {
  const bad = [
    { kind: "read", id: "1", fn: "jira.listStories", args: [] },
    { kind: "write", fn: "jira.setEstimate", args: "SYN-12" },
    { kind: "write", fn: "jira.createStory", args: [], ref: "new:0" },
    { kind: "write", fn: "jira.createStory", args: [], ref: "jira:SYN-1" },
    { kind: "exec", command: "rm -rf /" },
    "done",
    null,
  ];
  for (const message of bad) assert.equal(guestMessage(message).ok, false, JSON.stringify(message));
});
