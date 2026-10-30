// SYN as a source, from the frozen fixtures, for unit tests and evals. It
// behaves like the Jira source where tests can tell: pages ordered by update,
// an `updated` cursor, no gone IDs from a listing (Jira's search can't list
// deletions, so the sync worker's full sweep must find them), and a deleted
// issue read as gone.
import { type FixtureSnapshot, fixtureSnapshot, type JiraFixture } from "./fixture.ts";
import { jiraOps } from "./ops.ts";
import type { JiraSource } from "./source.ts";

export type FixtureSourceOptions = {
  // Where item locations point, such as "https://oriel.atlassian.net".
  site: string;
  // How many of the fixture's source edits have happened (0 is the base).
  edited: number;
  pageSize?: number;
};

export function fixtureSource(fixture: JiraFixture, options: FixtureSourceOptions): JiraSource {
  const snapshot: FixtureSnapshot = fixtureSnapshot(fixture, options.site, options.edited);
  const pageSize = Math.max(Math.trunc(options.pageSize ?? 50), 1);
  const ordered = snapshot.records.toSorted(
    (a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id),
  );
  return {
    kind: "jira",
    ops: jiraOps,

    async *sync(cursor) {
      const listed = cursor === null ? ordered : ordered.filter((r) => r.updatedAt >= cursor);
      let latest = cursor;
      for (let at = 0; at < listed.length; at += pageSize) {
        const records = listed.slice(at, at + pageSize).map((record) => structuredClone(record));
        latest = records.at(-1)?.updatedAt ?? latest;
        if (latest !== null) yield { records, gone: [], cursor: latest };
      }
    },

    async read(ids) {
      return ids.map((id) => {
        const content = snapshot.content.get(id);
        if (!content) return { id, status: "gone", reason: "deleted" };
        return { id, status: "ok", content: structuredClone(content) };
      });
    },
  };
}
