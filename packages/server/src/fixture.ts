// What the window shows until sync lands: SYN from `fixtures/jira/`, with
// every source edit applied, as of the last thing that happened in it, so the
// window and its "stuck" rules are the same on every run.
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
