// SYN as Jira's declared fixture (decision 0049): `fixtures/jira/`, its
// frozen regions, and its index after any number of its source edits, read
// from the snapshot with no site behind it.
import {
  type ChangeLogEntry,
  facetChanges,
  type Instant,
  type ItemId,
  itemId,
  type LoadedFixture,
  parseItemId,
  type ReadResult,
  type SourceFixture,
} from "@oriel/core";
import { jiraDeclaredFacets } from "./attrs.ts";
import { fixtureSnapshot, type JiraFixture, loadJiraFixture } from "./fixture.ts";
import type { Estimates } from "./namespace.ts";

// Where its items say they are.
export const jiraFixtureSite = "https://oriel.atlassian.net";

export const jiraDeclaredFixture: SourceFixture<Estimates> = {
  load: () => loaded(loadJiraFixture()),
  everyCase: true,
};

function loaded(fixture: JiraFixture): LoadedFixture<Estimates> {
  const stableIds = new Map(fixture.issues.map((issue) => [`jira:${issue.key}`, issue.id]));
  const firstEdit = fixture.edits.map((edit) => edit.at).toSorted()[0];
  return {
    edits: fixture.edits.length,
    firstEdit: (firstEdit ?? null) as Instant | null,
    regions: fixture.regions,
    // An issue by its key, such as SYN-12.
    item: (key) =>
      stableIds.has(`jira:${key}`)
        ? { id: itemId("jira", key) }
        : { problem: `no issue ${key} in the Jira fixture` },
    stableId: (id) => stableIds.get(id) ?? "",
    chips: (edited) =>
      fixtureSnapshot(fixture, jiraFixtureSite, edited).records.map(
        (record) =>
          [record.id, `${parseItemId(record.id)?.key ?? record.id} ${record.title}`] as const,
      ),
    connect: async (edited) => {
      const snapshot = fixtureSnapshot(fixture, jiraFixtureSite, edited);
      return {
        records: snapshot.records,
        read: async (ids) =>
          ids.map((id): ReadResult => {
            const content = snapshot.content.get(id as ItemId<"jira">);
            return content
              ? { id, status: "ok", content }
              : { id, status: "gone", reason: "deleted" };
          }),
        // As the app has it with no estimates turned off, and SYN its home.
        context: { none: new Set(), home: fixture.project.key },
        changes: (now) => changes(fixture, edited, now),
        close: () => {},
      };
    },
  };
}

// What the first `edited` edits changed, logged as a sync would log them,
// each at its edit's time.
function changes(
  fixture: JiraFixture,
  edited: number,
  now: Instant,
): Omit<ChangeLogEntry, "seq">[] {
  const before = fixtureSnapshot(fixture, jiraFixtureSite, 0).records;
  const after = new Map(
    fixtureSnapshot(fixture, jiraFixtureSite, edited).records.map((r) => [r.stableId, r]),
  );
  const editedAt = new Map(
    fixture.edits.slice(0, edited).map((edit) => [`jira:${edit.key}`, edit.at]),
  );
  return before.flatMap((was) => {
    const is = after.get(was.stableId);
    const facets = is ? facetChanges(jiraDeclaredFacets, was, is) : null;
    if (is && !facets) return [];
    const at = (editedAt.get(was.id) ?? now) as Instant;
    return [
      { source: "jira", stableId: was.stableId, version: 2, at, facets: facets ?? {}, gone: !is },
    ];
  });
}
