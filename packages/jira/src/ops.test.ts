import assert from "node:assert/strict";
import { test } from "node:test";
import { isJiraOp, jiraOps } from "./ops.ts";

test("op arguments validate against the catalogue", () => {
  assert.equal(jiraOps.setEstimate({ points: 3 }).ok, true);
  assert.equal(jiraOps.setEstimate({ points: null }).ok, true);
  assert.equal(jiraOps.setEstimate({ points: "3" }).ok, false);
  assert.equal(jiraOps.createStory({ summary: "Retry checkout", epic: "jira:SYN-1" }).ok, true);
  assert.equal(jiraOps.createStory({ epic: null }).ok, false);
});

test("only catalogue ops are ops, inherited names included", () => {
  assert.equal(isJiraOp("setEstimate"), true);
  assert.equal(isJiraOp("toString"), false);
  assert.equal(isJiraOp("zeroAllEstimates"), false);
});
