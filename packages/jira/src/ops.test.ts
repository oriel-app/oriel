import assert from "node:assert/strict";
import { test } from "node:test";
import { isJiraOp, jiraOps } from "./ops.ts";

test("op arguments validate against the catalogue", () => {
  assert.equal(jiraOps.setEstimate.args({ points: 3 }).ok, true);
  assert.equal(jiraOps.setEstimate.args({ points: null }).ok, true);
  assert.equal(jiraOps.setEstimate.args({ points: "3" }).ok, false);
  assert.equal(
    jiraOps.createStory.args({ summary: "Retry checkout", epic: "jira:SYN-1" }).ok,
    true,
  );
  assert.equal(jiraOps.createStory.args({ epic: null }).ok, false);
});

test("only catalogue ops are ops, inherited names included", () => {
  assert.equal(isJiraOp("setEstimate"), true);
  assert.equal(isJiraOp("toString"), false);
  assert.equal(isJiraOp("zeroAllEstimates"), false);
});

test("a summary is 1 to 255 characters, counted as characters, not UTF-16 units", () => {
  const ok = (summary: string) => jiraOps.setSummary.args({ summary }).ok;
  assert.equal(ok("x"), true);
  assert.equal(ok("🛳".repeat(255)), true);
  for (const summary of ["", "  \n", "x".repeat(256), "🛳".repeat(256)])
    assert.equal(ok(summary), false, JSON.stringify(summary.slice(0, 8)));
  assert.equal(jiraOps.createStory.args({ summary: " ", epic: null }).ok, false);
});

test("a link to remove is named by digits only", () => {
  const ok = (linkId: string) => jiraOps.removeLink.args({ linkId }).ok;
  assert.equal(ok("10100"), true);
  for (const linkId of ["", "0", "01", "10100 ", "-1", "1e3", "../../project/SYN", "10100/x"])
    assert.equal(ok(linkId), false, linkId);
});

test("a link to add must be https", () => {
  const ok = (url: string) => jiraOps.addLink.args({ url, title: "Runbook" }).ok;
  assert.equal(ok("https://runbook.example.com/retry"), true);
  for (const url of [
    "http://runbook.example.com",
    "javascript:alert(1)",
    "data:text/html,<b>hi</b>",
    "ftp://files.example.com/x",
    "runbook.example.com",
    "",
  ])
    assert.equal(ok(url), false, url);
});

test("only removeLink and deleteItem are revert-only", () => {
  assert.deepEqual(
    Object.entries(jiraOps).flatMap(([op, spec]) => (spec.revertOnly ? [op] : [])),
    ["removeLink", "deleteItem"],
  );
});
