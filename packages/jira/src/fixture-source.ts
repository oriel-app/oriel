// No gone IDs from a listing: Jira's search can't list deletions, so the sync worker's full sweep must find them.
import type { FieldValues, ItemId } from "@oriel/core";
import { jiraText } from "./attrs.ts";
import { type FixtureSnapshot, fixtureSnapshot, type JiraFixture } from "./fixture.ts";
import { jiraOps } from "./ops.ts";
import type { JiraSource } from "./source.ts";

export function fixtureFields(fixture: JiraFixture, options: FixtureSourceOptions) {
  const { records, content } = fixtureSnapshot(fixture, options.site, options.edited);
  const updated = new Map(records.map((record) => [record.id, record.updatedAt]));
  const people = new Map(fixture.people.map((person) => [person.id, person.displayName]));
  return {
    async current(id: ItemId<"jira">, fields: readonly string[]): Promise<FieldValues | "gone"> {
      const found = content.get(id);
      if (!found) return "gone";
      const values: Record<string, unknown> = {
        summary: found.summary,
        description: found.description,
        points: found.points,
        assignee: found.assignee?.accountId ?? null,
        epic: found.epic,
        status: found.status.name,
        updated: updated.get(id) ?? null,
        ...Object.fromEntries(
          found.links.map((link) => [`link:${link.linkId}`, { url: link.url, title: link.title }]),
        ),
      };
      return Object.fromEntries(
        fields.map((field) => [field, Object.hasOwn(values, field) ? values[field] : null]),
      );
    },
    async person(accountId: string): Promise<string | null> {
      return people.get(accountId) ?? null;
    },
    // What a diff calls an ID an op names: in Jira, every such ID is a
    // person's account.
    async name(id: string): Promise<string | null> {
      return people.get(id) ?? null;
    },
  };
}

export type FixtureSourceOptions = {
  site: string;
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
        const texts = Object.fromEntries(
          records.flatMap((record) => {
            const content = snapshot.content.get(record.id);
            return content
              ? [[record.stableId, jiraText({ ...content, comments: [] })] as const]
              : [];
          }),
        );
        latest = records.at(-1)?.updatedAt ?? latest;
        if (latest !== null) yield { records, gone: [], cursor: latest, texts };
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
