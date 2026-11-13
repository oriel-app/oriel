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
import {
  jiraProblem,
  jiraProject,
  type JiraWrites,
  type OpenedJira,
  searchLagMs,
} from "./open-connection.ts";
import type { JiraScope } from "./references.ts";
import { jiraSource } from "./source.ts";
import { memoryTransport, readOnly } from "./transport.ts";

export const jiraFixtureSite = "https://oriel.atlassian.net";

export const jiraDeclaredFixture: SourceFixture<Estimates, JiraScope, JiraWrites> = {
  load: () => loaded(loadJiraFixture()),
  everyCase: true,
  windowCase: true,
  connection: () => ({
    identity: jiraFixtureSite,
    options: { project: loadJiraFixture().project.key },
  }),
  open: async (connection, via) => opened(loadJiraFixture(), connection, via),
  memory: async (connection, via) => overMemory(connection, via),
};

export function frozenAt(fixture: JiraFixture): Instant {
  const { records } = fixtureSnapshot(fixture, jiraFixtureSite, fixture.edits.length);
  // Instants sort as strings.
  const last = [...records.map((record) => record.updatedAt), ...fixture.edits.map((e) => e.at)]
    .toSorted()
    .at(-1);
  if (last === undefined) throw new RangeError("the fixture has no issues and no edits");
  return last as Instant;
}

function opened(fixture: JiraFixture, connection: ToOpen, via: OpenVia): OpenedJira {
  const site = connection.identity;
  const edited = fixture.edits.length;
  const project = fixture.project.key;
  const send = via.fetch;
  const writes: JiraWrites | null = send
    ? {
        site,
        memory: send,
        project,
        boards: jiraBoards({
          transport: readOnly(memoryTransport(site, send)),
          projects: [project],
          log: via.log,
        }),
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
    problem: jiraProblem,
  };
}

function overMemory(connection: ToOpen, via: OpenVia & { fetch: typeof fetch }): OpenedJira {
  const site = connection.identity;
  const project = jiraProject(connection.options);
  if (!project) throw new RangeError("a Jira connection over a site in memory names its project");
  const transport = readOnly(memoryTransport(site, via.fetch));
  const boards = jiraBoards({ transport, projects: [project], log: via.log });
  return {
    source: jiraSource({ transport, site, projects: [project], log: via.log, boards }),
    attrs: jiraAttrs,
    about: `${project} on ${URL.parse(site)?.host ?? site}`,
    scope: { projects: [project] },
    context: () => ({ none: boards.unestimating() ?? new Set(), home: project }),
    writes: { site, memory: via.fetch, project, boards },
    incremental: true,
    lagMs: searchLagMs,
    problem: jiraProblem,
  };
}

function loaded(fixture: JiraFixture): LoadedFixture<Estimates> {
  const stableIds = new Map(fixture.issues.map((issue) => [`jira:${issue.key}`, issue.id]));
  const firstEdit = fixture.edits.map((edit) => edit.at).toSorted()[0];
  return {
    edits: fixture.edits.length,
    firstEdit: (firstEdit ?? null) as Instant | null,
    regions: fixture.regions,
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
        context: { none: new Set(), home: fixture.project.key },
        changes: (now) => changes(fixture, edited, now),
        close: () => {},
      };
    },
  };
}

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
