import type { Instant } from "@oriel/core";
import {
  fixtureSnapshot,
  frozenAt,
  type JiraFixture,
  type JiraRecord,
  loadJiraFixture,
} from "@oriel/jira";

export function fixtureIndex(fixture: JiraFixture = loadJiraFixture()): {
  records: JiraRecord[];
  now: Instant;
} {
  const { records } = fixtureSnapshot(fixture, "https://oriel.atlassian.net", fixture.edits.length);
  return { records, now: frozenAt(fixture) };
}
