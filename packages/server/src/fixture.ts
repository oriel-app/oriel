// What the window shows until sync lands: SYN from `fixtures/jira/`, with
// every source edit applied, as of the last thing that happened in it, so the
// window and its "stuck" rules are the same on every run.
import type { Instant } from "@oriel/core";
import { fixtureSnapshot, type JiraFixture } from "@oriel/jira";
import type { JiraRecord } from "@oriel/groupings";
import { loadJiraFixture } from "../../../scripts/fixtures/load.ts";

export function fixtureIndex(fixture: JiraFixture = loadJiraFixture()): {
  records: JiraRecord[];
  now: Instant;
} {
  const { records } = fixtureSnapshot(fixture, "https://oriel.atlassian.net", fixture.edits.length);
  // Instants sort as strings.
  const now = [...records.map((record) => record.updatedAt), ...fixture.edits.map((e) => e.at)]
    .toSorted()
    .at(-1);
  if (now === undefined) throw new RangeError("the fixture has no issues and no edits");
  return { records, now };
}
