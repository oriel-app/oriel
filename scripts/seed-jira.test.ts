import assert from "node:assert/strict";
import { test } from "node:test";
import { jiraEnv } from "./seed-jira.ts";

test("only the three Jira values are read, and only for the throwaway site", () => {
  const env =
    "JIRA_SITE=https://oriel.atlassian.net\nJIRA_EMAIL=a@example.com\nJIRA_API_TOKEN=t0k3n\nGH_TOKEN=github_pat_x\n";
  assert.deepEqual(jiraEnv(env), {
    site: "https://oriel.atlassian.net",
    email: "a@example.com",
    token: "t0k3n",
  });
  for (const file of [
    null,
    "JIRA_SITE=https://oriel.atlassian.net\nJIRA_EMAIL=a@example.com\n",
    "JIRA_SITE=https://work.atlassian.net\nJIRA_EMAIL=a@example.com\nJIRA_API_TOKEN=t0k3n\n",
    "JIRA_SITE=not a url\nJIRA_EMAIL=a@example.com\nJIRA_API_TOKEN=t0k3n\n",
  ]) {
    const result = jiraEnv(file);
    assert.ok("error" in result, JSON.stringify(file));
    assert.ok(!result.error.includes("t0k3n") && !result.error.includes("work."));
  }
});
