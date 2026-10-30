import assert from "node:assert/strict";
import { test } from "node:test";
import { serverEnv } from "./env.ts";

const full = [
  "JIRA_SITE=https://oriel.atlassian.net",
  "JIRA_EMAIL=pm@example.com",
  "JIRA_API_TOKEN=secret-token-value",
  "ANTHROPIC_API_KEY=secret-model-key",
  "GH_TOKEN=not-read",
].join("\n");

test("Jira's three values and the model key are read, and nothing else", () => {
  const env = serverEnv(full);
  assert.deepEqual(env, {
    jira: {
      site: "https://oriel.atlassian.net",
      email: "pm@example.com",
      token: "secret-token-value",
    },
    modelKey: "secret-model-key",
  });
});

test("without them the server runs read-only, and no message carries a value", () => {
  for (const file of [null, "", "JIRA_SITE=https://oriel.atlassian.net\nJIRA_EMAIL=a@b.c"]) {
    const env = serverEnv(file);
    assert.ok("problem" in env.jira);
    assert.equal(env.modelKey, null);
  }
  const elsewhere = serverEnv(full.replace("oriel.atlassian.net", "example.atlassian.net"));
  assert.ok("problem" in elsewhere.jira);
  assert.doesNotMatch(JSON.stringify(elsewhere.jira), /secret|example\.atlassian/);
  assert.equal(serverEnv("ANTHROPIC_API_KEY=  ").modelKey, null);
});
