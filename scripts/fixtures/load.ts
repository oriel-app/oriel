// Reads `fixtures/jira/<part>.json` and validates it as one fixture.
import { readFileSync } from "node:fs";
import {
  type JiraFixture,
  jiraFixtureParts,
  parseJiraFixture,
} from "../../packages/jira/src/fixture.ts";

export const fixtureDir = new URL("../../fixtures/jira/", import.meta.url);

export function loadJiraFixture(dir: URL = fixtureDir): JiraFixture {
  const input = Object.fromEntries(
    jiraFixtureParts.map((part) => [
      part,
      JSON.parse(readFileSync(new URL(`${part}.json`, dir), "utf8")) as unknown,
    ]),
  );
  const result = parseJiraFixture(input);
  if (result.ok) return result.value;
  const issues = result.issues.map((issue) => `${issue.path}: ${issue.message}`);
  throw new Error(`invalid Jira fixture:\n${issues.join("\n")}`);
}
