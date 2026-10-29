import assert from "node:assert/strict";
import { test } from "node:test";
import { loadJiraFixture } from "./fixtures/load.ts";
import { adf, dryRun, jiraEnv, plan } from "./seed-jira.ts";

const fixture = loadJiraFixture();
const steps = plan(fixture);
const keyNumber = (key: string) => Number(key.slice(key.lastIndexOf("-") + 1));

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

test("issues are created in key order, gaps included, so live keys match", () => {
  const created = steps.filter((s) => s.kind === "create" || s.kind === "placeholder");
  const last = Math.max(...fixture.issues.map((issue) => keyNumber(issue.key)));
  assert.deepEqual(
    created.map((s) => s.key),
    Array.from({ length: last }, (_, i) => `SYN-${i + 1}`),
  );
  const placeholders = created.filter((s) => s.kind === "placeholder");
  assert.equal(placeholders.length, last - fixture.issues.length);
  for (const placeholder of placeholders) {
    const at = steps.indexOf(placeholder);
    assert.deepEqual(steps[at + 1], { kind: "delete", key: placeholder.key });
  }
});

test("only issues this plan created are deleted, and changes come last, in order", () => {
  const created = new Set<string>();
  for (const step of steps) {
    if (step.kind === "create" || step.kind === "placeholder") created.add(step.key);
    if (step.kind === "delete") assert.ok(created.has(step.key), step.key);
  }
  const tail = steps.slice(-fixture.changes.length);
  assert.deepEqual(
    tail.map((s) => [s.kind, s.key]),
    fixture.changes.map((c) => [c.kind === "delete" ? "delete" : "edit", c.key]),
  );
});

test("assignees are not seeded; each assigned issue gets a note instead", () => {
  const assigned = fixture.issues.filter((issue) => issue.assignee !== null);
  const notes = steps.filter((s) => s.kind === "comment" && s.body.startsWith("Seeded unassigned"));
  assert.equal(notes.length, assigned.length);
  const creates = dryRun(fixture).filter(
    (line) => line.startsWith("POST /rest/api/3/issue {") && !line.includes("Placeholder for"),
  );
  assert.equal(creates.length, fixture.issues.length);
  assert.ok(creates.every((line) => line.includes('"assignee":null')));
});

test("the dry run names no field IDs and prints placeholders for discovered values", () => {
  const lines = dryRun(fixture);
  assert.ok(!lines.some((line) => /customfield_/.test(line)));
  assert.ok(lines.some((line) => line.includes('"<Story Points field>":')));
  assert.ok(lines.some((line) => line.includes('"parent":{"key":"SYN-')));
});

test("plain text becomes literal paragraphs and hard breaks", () => {
  assert.deepEqual(adf("One *line*\ntwo\n\nThree"), {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "One *line*" },
          { type: "hardBreak" },
          { type: "text", text: "two" },
        ],
      },
      { type: "paragraph", content: [{ type: "text", text: "Three" }] },
    ],
  });
});
