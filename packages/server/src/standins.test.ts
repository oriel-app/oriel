// A stand-in whose name drifts from its real server's leaves that server in place: a dev world meant to write to a stand-in
// once wrote to the maintainer's real Jira backlog. Every stand-in must replace its server.
import assert from "node:assert/strict";
import { test } from "node:test";
import { devStandIns } from "./standins.ts";

test("every dev stand-in replaces the real server it stands in for", () => {
  const started = devStandIns("atlassian,slack,linear,sheets");
  assert.ok(started);
  const swapped = started.known
    .filter((each) => each.server.at && "command" in each.server.at)
    .map((each) => each.kind);
  assert.deepEqual([...swapped].sort(), ["jira", "linear", "sheets", "slack"]);
});
