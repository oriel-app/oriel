import assert from "node:assert/strict";
import { test } from "node:test";
import { databaseName, flagged, inWindow } from "./modes.ts";

test("pnpm dev's database is one per set of modes, and Jira's mode alone keeps today's file", () => {
  // No flags: Jira's fixture, as before connections.
  assert.equal(databaseName({ jira: "fixture" }), "fixture");
  assert.equal(databaseName({ jira: "live" }), "live");
  assert.equal(databaseName({ jira: "window" }), "window");
  // The live server's, `--jira live --slack live`, and the fixtures together.
  assert.equal(databaseName({ jira: "live", slack: "live" }), "live");
  assert.equal(databaseName({ jira: "fixture", slack: "fixture" }), "fixture");
  // Fixture and `.env` connections never share one.
  assert.equal(databaseName({ slack: "live", jira: "fixture" }), "jira-fixture+slack-live");
});

test("a kind with no mode is made in the window when its connector declares how, and not otherwise", () => {
  assert.equal(inWindow({}, "folder"), true);
  assert.equal(inWindow({}, "jira"), true);
  assert.equal(inWindow({}, "slack"), false);
  assert.equal(inWindow({ jira: { mode: "fixture" } }, "jira"), false);
  assert.equal(inWindow({ slack: { mode: "window" } }, "slack"), true);
});

test("a flag's connection is its fixture's or what it names, and the window's are none", () => {
  const made = flagged({
    jira: { mode: "fixture" },
    slack: {
      mode: "live",
      identity: "",
      options: { channels: ["a"] },
      secret: "xoxp-token",
    },
    folder: { mode: "window" },
  });
  assert.deepEqual(
    made.map(({ kind, fixture, options, secret }) => ({ kind, fixture, options, secret })),
    [
      { kind: "jira", fixture: true, options: { project: "SYN" }, secret: null },
      { kind: "slack", fixture: false, options: { channels: ["a"] }, secret: "xoxp-token" },
    ],
  );
});
