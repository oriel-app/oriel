// Where evals read and write, from the repo root, whatever the working
// directory: `pnpm evals` runs from the root, `evals:ci` from this package.
import { readFileSync } from "node:fs";
import { type JiraFixture, jiraFixtureParts, parseJiraFixture } from "@oriel/jira";

export const repoRoot = new URL("../../../", import.meta.url);
export const casesDir = new URL("packages/evals/cases/", repoRoot);
export const cassettesDir = new URL("tests/cassettes/", repoRoot);
export const roundsDir = new URL(".evals/", repoRoot);
export const envFile = new URL(".env", repoRoot);
const fixtureDir = new URL("fixtures/jira/", repoRoot);

// Reads `fixtures/jira/<part>.json` as one validated fixture.
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
