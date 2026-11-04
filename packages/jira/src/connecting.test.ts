import assert from "node:assert/strict";
import { test } from "node:test";
import { jiraLive, jiraOptions, jiraSite } from "./connecting.ts";

const env = {
  JIRA_SITE: "https://oriel.atlassian.net",
  JIRA_EMAIL: "pm@example.com",
  JIRA_API_TOKEN: "secret-token-value",
};

test("a live connection reads Jira's three values, to the throwaway site, SYN unless a flag says", () => {
  assert.deepEqual(jiraLive.env, ["JIRA_SITE", "JIRA_EMAIL", "JIRA_API_TOKEN"]);
  assert.deepEqual(jiraLive.connection(env, {}), {
    identity: "https://oriel.atlassian.net",
    options: { project: "SYN" },
    secret: JSON.stringify({ email: "pm@example.com", token: "secret-token-value" }),
  });
  assert.deepEqual(jiraLive.connection(env, { project: "OA" }).options, { project: "OA" });
});

test("without them, or to another site, no message carries a value", () => {
  const partial: Record<string, string>[] = [
    {},
    { JIRA_SITE: env.JIRA_SITE, JIRA_EMAIL: env.JIRA_EMAIL },
  ];
  for (const given of partial) assert.ok("problem" in jiraLive.connection(given, {}));
  const elsewhere = jiraLive.connection({ ...env, JIRA_SITE: "https://example.atlassian.net" }, {});
  assert.ok("problem" in elsewhere);
  assert.doesNotMatch(JSON.stringify(elsewhere), /secret|example\.atlassian/);
  const project = jiraLive.connection(env, { project: "not a key" });
  assert.ok("problem" in project);
  assert.doesNotMatch(JSON.stringify(project), /not a key/);
});

test("a site is typed the ways people type it", () => {
  for (const typed of [
    "oriel",
    "oriel.atlassian.net",
    " Oriel.Atlassian.net/ ",
    "https://oriel.atlassian.net/jira/software/projects/SYN/boards/1",
  ])
    assert.equal(jiraSite(typed), "https://oriel.atlassian.net", typed);
  for (const typed of [
    "",
    "http://oriel.atlassian.net",
    "https://oriel.atlassian.net:8443",
    "https://user:pw@oriel.atlassian.net",
    "oriel.atlassian.net.evil.example",
    "169.254.169.254",
  ])
    assert.equal(jiraSite(typed), null, typed);
});

test("a connection's options are a project key, and whether it's read-only, and the check never quotes one", () => {
  assert.deepEqual(jiraOptions({ project: "SYN", other: 1 }), {
    ok: true,
    value: { project: "SYN", readOnly: undefined },
  });
  assert.deepEqual(jiraOptions({ project: "SYN", readOnly: true }), {
    ok: true,
    value: { project: "SYN", readOnly: true },
  });
  assert.equal(jiraOptions({ project: "SYN", readOnly: "yes" }).ok, false);
  for (const project of ["syn", "", "SYN OR 1=1", "S".repeat(33), 12]) {
    const checked = jiraOptions({ project });
    assert.equal(checked.ok, false);
    assert.doesNotMatch(JSON.stringify(checked), /SYN OR/);
  }
});
