import assert from "node:assert/strict";
import { test } from "node:test";
import { jiraOps } from "./ops.ts";

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

test("a comment is 1 to 32,767 characters, and one to remove is named by digits only", () => {
  const ok = (body: string) => jiraOps.addComment.args({ body }).ok;
  assert.equal(ok("The date moved: the supplier slipped."), true);
  assert.equal(ok("🛳".repeat(32_767)), true);
  for (const body of ["", " \n ", "x".repeat(32_768)])
    assert.equal(ok(body), false, JSON.stringify(body.slice(0, 8)));
  const id = (commentId: string) => jiraOps.removeComment.args({ commentId }).ok;
  assert.equal(id("10001"), true);
  for (const commentId of ["", "0", "10001 ", "../../issue/SYN-1", "10001?x"])
    assert.equal(id(commentId), false, commentId);
});
