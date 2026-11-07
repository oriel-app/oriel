// Linear's read side, through its server's read tools (OA-278): a sync
// lists the team's statuses, cycles, projects and issues, and lands them
// only once every page read, so an answer it can't read keeps the index as
// it was. A read asks for each item by itself. What the last sync found of
// the team is what the namespace and the writer go by.
import {
  type IndexRecord,
  type ItemId,
  type IssueAttrs,
  parseItemId,
  type ReadResult,
  type Source,
} from "@oriel/core";
import {
  issueContent,
  isProjectKey,
  type LinearContent,
  linearIssueRecord,
  projectContent,
  projectRecord,
  type TeamWorld,
} from "./items.ts";
import { type LinearReads, type LinearTeam } from "./linear-mcp.ts";

export type LinearSource = Source<"linear", IssueAttrs, LinearContent> & {
  // The team as the last sync found it, or as a read before any found it.
  world(): Promise<TeamWorld>;
  known(): TeamWorld | null;
};

export function linearSource(options: {
  reads: LinearReads;
  team: LinearTeam;
  prefix?: string;
}): LinearSource {
  const { reads, team } = options;
  const prefix = options.prefix ?? "linear";
  let found: TeamWorld | null = null;
  // Each issue's identifier by its UUID, for a parent's, from the last sync.
  let identifiers = new Map<string, string>();

  const look = async (): Promise<TeamWorld> => ({
    team,
    statuses: await reads.statuses(team.id),
    cycles: await reads.cycles(team.id),
    projects: await reads.projects(team.id),
  });
  const world = async () => (found ??= await look());

  return {
    kind: "linear",
    prefix,
    known: () => found,
    world,
    async *sync() {
      // Everything before anything lands.
      const fresh = await look();
      const issues = (await reads.issues(team.id)).filter((issue) =>
        issue.identifier.startsWith(`${team.key}-`),
      );
      const byId = new Map(
        issues.map((issue) => [issue.id, `${prefix}:${issue.identifier}` as ItemId]),
      );
      const records: IndexRecord<"linear", IssueAttrs>[] = [
        ...fresh.projects.map(projectRecord),
        ...issues.map((issue) => linearIssueRecord(issue, fresh, byId)),
      ].map((record) => ({ ...record, id: withPrefix(record.id, prefix) }));
      found = fresh;
      identifiers = new Map(issues.map((issue) => [issue.id, issue.identifier]));
      yield {
        records,
        gone: [],
        cursor: null,
        texts: Object.fromEntries([
          ...fresh.projects.map((each) => [each.id, projectContent(each).text]),
          ...issues.map((issue) => [issue.id, issueContent(issue, fresh, identifiers).text]),
        ]),
      };
    },
    async read(ids) {
      const team = await world();
      return Promise.all(
        ids.map(async (id): Promise<ReadResult<"linear", LinearContent>> => {
          const key = parseItemId(id)?.key ?? "";
          if (isProjectKey(key)) {
            const slug = key.slice(2);
            const known = team.projects.find((each) => each.slugId === slug);
            const project = known ? await reads.project(known.id) : null;
            return project && project.slugId === slug
              ? { id, status: "ok", content: projectContent(project) }
              : { id, status: "gone", reason: "deleted" };
          }
          const issue = await reads.issue(key);
          if (!issue || issue.identifier !== key) return { id, status: "gone", reason: "deleted" };
          return { id, status: "ok", content: issueContent(issue, team, identifiers) };
        }),
      );
    },
  };
}

// An item ID under a later connection's prefix, as `linear.2:ENG-4`.
const withPrefix = (id: ItemId<"linear">, prefix: string): ItemId<"linear"> =>
  prefix === "linear" ? id : (`${prefix}:${parseItemId(id)?.key ?? ""}` as ItemId<"linear">);
