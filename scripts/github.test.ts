import assert from "node:assert/strict";
import { test } from "node:test";
import { prepare } from "./github.ts";

const env = "JIRA_API_TOKEN=secret\nGH_TOKEN=github_pat_abc\nANTHROPIC_API_KEY=key\n";

test("passes the agent token and the arguments through", () => {
  assert.deepEqual(prepare(["pr", "view", "7"], env), {
    args: ["pr", "view", "7"],
    token: "github_pat_abc",
  });
});

test("refuses without a fine-grained token in .env", () => {
  for (const file of [null, "", "GH_TOKEN=gho_classic\n", "JIRA_API_TOKEN=github_pat_x\n"]) {
    assert.ok("error" in prepare(["pr", "view"], file), JSON.stringify(file));
  }
});

test("refuses subcommands that print tokens, run code or touch secrets", () => {
  for (const command of ["auth", "alias", "extension", "config", "secret", "variable"]) {
    assert.ok("error" in prepare([command, "list"], env), command);
  }
  assert.ok("error" in prepare([], env));
});
