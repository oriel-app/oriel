import assert from "node:assert/strict";
import { test } from "node:test";
import { agentToken, headRefusal, leaksSecret, parse, published } from "./github.ts";

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
  assert.deepEqual(parse(["pr-edit", "11", "new body"]), {
    op: "pr-edit",
    number: 11,
    body: "new body",
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
    ["pr-edit", "11"],
    ["pr-edit", "11", "   "],
    ["pr-edit", "0", "body"],
    ["pr-edit", "11", "body", "--title", "x"],
  ];
  for (const args of refused) assert.ok("error" in parse(args), JSON.stringify(args));
});

test("a token with whitespace or junk is refused, so it can't leak into a header error", () => {
  assert.equal(agentToken('GH_TOKEN="github_pat_abc\nmore"\n'), null);
  assert.equal(agentToken("GH_TOKEN=github_pat_abc def\n"), null);
});

test("only this repo's own branches may be enqueued or edited", () => {
  const own = { isCrossRepository: false, headRepository: { nameWithOwner: "oriel-app/oriel" } };
  for (const action of ["enqueue", "edit"] as const) {
    assert.equal(headRefusal(own, action), null);
    assert.match(
      headRefusal({ ...own, isCrossRepository: true }, action) ?? "",
      new RegExp(`refusing to ${action}`),
    );
    const fork = { isCrossRepository: false, headRepository: { nameWithOwner: "evil/oriel" } };
    assert.match(headRefusal(fork, action) ?? "", /evil\/oriel/);
    assert.match(
      headRefusal({ isCrossRepository: false, headRepository: null }, action) ?? "",
      /deleted/,
    );
  }
});

test("a title or body carrying a value from .env is caught", () => {
  const env =
    "JIRA_API_TOKEN=ATATT3xFfGF0secretvalue\nJIRA_SITE=https://oriel.atlassian.net\nSHORT=abc\n";
  assert.equal(leaksSecret(["fix: x", "token ATATT3xFfGF0secretvalue here"], env), true);
  assert.equal(leaksSecret(["fix: x", "see https://oriel.atlassian.net/browse/SYN-1"], env), false);
  assert.equal(leaksSecret(["fix: abc", "plain body"], env), false);
  assert.equal(leaksSecret(["anything"], null), false);
});

test("pr-edit takes an optional title after the body, never empty", () => {
  assert.deepEqual(parse(["pr-edit", "11", "new body", "feat: x (OA-1, OA-2)"]), {
    op: "pr-edit",
    number: 11,
    body: "new body",
    title: "feat: x (OA-1, OA-2)",
  });
  for (const args of [
    ["pr-edit", "11", "body", ""],
    ["pr-edit", "11", "body", "  "],
    ["pr-edit", "11", "  ", "title"],
    ["pr-edit", "0", "body", "title"],
    ["pr-edit", "11", "body", "title", "extra"],
  ])
    assert.ok("error" in parse(args), JSON.stringify(args));
});

test("an edit's new title is checked for values from .env, as a new PR's is", () => {
  const env = "ANTHROPIC_API_KEY=sk-ant-fakefakefake\nJIRA_SITE=https://oriel.atlassian.net\n";
  const leaks = (args: string[]) => {
    const operation = parse(args);
    assert.ok(!("error" in operation), JSON.stringify(args));
    return leaksSecret(published(operation), env);
  };
  assert.equal(leaks(["pr-edit", "11", "body", "fix: sk-ant-fakefakefake"]), true);
  assert.equal(leaks(["pr-edit", "11", "sk-ant-fakefakefake", "fix: x"]), true);
  assert.equal(leaks(["pr-create", "ok-branch", "fix: sk-ant-fakefakefake", "b"]), true);
  assert.equal(leaks(["pr-edit", "11", "body", "fix: https://oriel.atlassian.net"]), false);
  assert.equal(leaks(["pr-edit", "11", "body"]), false);
  assert.deepEqual(published({ op: "pr-view", number: 1 }), []);
});
