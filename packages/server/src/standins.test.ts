// Dev stand-ins (OA-276–279): a stand-in whose name drifts from its real
// server's leaves that real server in place, so a dev world meant to write
// to a stand-in wrote to the maintainer's real Jira backlog (found by the
// QA pass after #237, 2026-11-08). Every stand-in must replace its server.
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
