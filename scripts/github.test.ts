import assert from "node:assert/strict";
import { test } from "node:test";
import { agentToken, parse } from "./github.ts";

test("only the agent token from .env is accepted", () => {
  assert.equal(agentToken("JIRA_API_TOKEN=secret\nGH_TOKEN=github_pat_abc\n"), "github_pat_abc");
  for (const file of [null, "", "GH_TOKEN=gho_classic\n", "JIRA_API_TOKEN=github_pat_x\n"]) {
    assert.equal(agentToken(file), null, JSON.stringify(file));
  }
});

test("the fixed operations parse", () => {
  assert.deepEqual(parse(["pr-list"]), { op: "pr-list" });
  assert.deepEqual(parse(["pr-view", "7"]), { op: "pr-view", number: 7 });
  assert.deepEqual(parse(["pr-enqueue", "12"]), { op: "pr-enqueue", number: 12 });
  assert.deepEqual(parse(["pr-create", "readme-header", "docs: x", "body"]), {
    op: "pr-create",
    branch: "readme-header",
    title: "docs: x",
    body: "body",
  });
  assert.deepEqual(parse(["runs"]), { op: "runs", branch: null });
  assert.deepEqual(parse(["runs", "db-schema"]), { op: "runs", branch: "db-schema" });
});

test("anything else is refused, flags and gh commands included", () => {
  const refused = [
    [],
    ["auth", "token"],
    ["--user", "vibdev", "auth", "token"],
    ["ext", "install", "o/gh-x"],
    ["api", "-F", "b=@.env", "/x"],
    ["pr-view", "7", "--hostname", "evil.example"],
    ["pr-view", "0"],
    ["pr-view", "7; rm -rf /"],
    ["pr-create", "feature/x", "t", "b"],
    ["pr-create", "one-two-three-four", "t", "b"],
    ["pr-create", "ok-branch", "  ", "b"],
    ["pr-create", "ok-branch", "t"],
    ["repo", "clone", "o/r", "--", "-c", "x=y"],
    ["runs", "a", "b"],
  ];
  for (const args of refused) assert.ok("error" in parse(args), JSON.stringify(args));
});
