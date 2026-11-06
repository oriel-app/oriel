// SYN as Jira's declared fixture (decision 0049): `fixtures/jira/`, its
// frozen regions, and its index after any number of its source edits, read
// from the snapshot with no site behind it.
import {
  type ChangeLogEntry,
  facetChanges,
  type Instant,
  issueDeclaredFacets,
  type ItemId,
  itemId,
  type LoadedFixture,
  listed,
  type OpenVia,
  parseItemId,
  type ReadResult,
  type SourceFixture,
  type ToOpen,
} from "@oriel/core";
import { jiraAttrs } from "./attrs.ts";
import { jiraBoards } from "./boards.ts";
import { fixtureSnapshot, type JiraFixture, loadJiraFixture } from "./fixture.ts";
import { fixtureFields, fixtureSource } from "./fixture-source.ts";
import type { Estimates } from "./namespace.ts";
import { jiraProblem, type JiraWrites, type OpenedJira } from "./open-connection.ts";
import type { JiraScope } from "./references.ts";
import { readTransport } from "./transport.ts";

// Where its items say they are.
export const jiraFixtureSite = "https://oriel.atlassian.net";

export const jiraDeclaredFixture: SourceFixture<Estimates, JiraScope, JiraWrites> = {
  load: () => loaded(loadJiraFixture()),
  everyCase: true,
  connection: () => ({
    identity: jiraFixtureSite,
    options: { project: loadJiraFixture().project.key },
  }),
  open: async (connection, via) => opened(loadJiraFixture(), connection, via),
};

// The instant SYN is frozen at: its last change, an issue's or an edit's.
export function frozenAt(fixture: JiraFixture): Instant {
  const { records } = fixtureSnapshot(fixture, jiraFixtureSite, fixture.edits.length);
  // Instants sort as strings.
  const last = [...records.map((record) => record.updatedAt), ...fixture.edits.map((e) => e.at)]
    .toSorted()
    .at(-1);
  if (last === undefined) throw new RangeError("the fixture has no issues and no edits");
  return last as Instant;
}

// SYN as the server opens it: read from the snapshot after every edit, as of
// its last, with no site behind it, so it's read-only. A test that gives a
// stand-in for its site (`via.fetch`) has change sets written there.
function opened(fixture: JiraFixture, connection: ToOpen, via: OpenVia): OpenedJira {
  const site = connection.identity;
  const edited = fixture.edits.length;
  const project = fixture.project.key;
  const send = via.fetch;
  // Nothing syncs the site, so its boards are found once, at the first
  // write that needs a points field.
  const to = send && { site, credential: { headers: async () => ({}) }, fetch: send };
  const writes: JiraWrites | null = to
    ? {
        ...to,
        project,
        boards: jiraBoards({ transport: readTransport(to), projects: [project], log: via.log }),
      }
    : null;
  return {
    source: fixtureSource(fixture, { site, edited }),
    attrs: jiraAttrs,
    about: `${project} on ${URL.parse(site)?.host ?? site}`,
    scope: { projects: [project] },
    context: () => ({ none: writes?.boards?.unestimating() ?? new Set(), home: project }),
    ...(writes ? { writes } : { fields: fixtureFields(fixture, { site, edited }) }),
    frozen: frozenAt(fixture),
    problem: (error) => jiraProblem(error, via.kept),
  };
}

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
      // Each issue's text as its sync gives it; the records in the fixture's order.
      const { texts } = await listed(
        fixtureSource(fixture, { site: jiraFixtureSite, edited }).sync(null),
      );
      return {
        records: snapshot.records,
        texts,
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
    const facets = is ? facetChanges(issueDeclaredFacets, was, is) : null;
    if (is && !facets) return [];
    const at = (editedAt.get(was.id) ?? now) as Instant;
    return [
      { source: "jira", stableId: was.stableId, version: 2, at, facets: facets ?? {}, gone: !is },
    ];
  });
}
