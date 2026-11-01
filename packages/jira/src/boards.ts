// What each project's board estimates in: its points field, or none when the
// board takes no estimates. The composition root makes one per connection
// and hands it to the source, which rediscovers it at the start of each sync,
// to the writer, and to the agent's module, so all three give one answer,
// and a board that turns estimation on or off is followed from the next
// sync, without a restart.
import type { Log } from "@oriel/core";
import { discoverPoints } from "./rest.ts";
import type { ReadTransport } from "./transport.ts";

export type JiraBoards = {
  // Rediscovers the listed projects' boards.
  refresh(): Promise<ReadonlyMap<string, string>>;
  // Each listed project's points field, as last discovered, or discovered
  // now if never.
  fields(): Promise<ReadonlyMap<string, string>>;
  // One project's points field, undefined when its board takes no
  // estimates. A project not listed, as one an item moved to, is discovered
  // on its own and kept until the next refresh.
  field(project: string): Promise<string | undefined>;
  // The listed projects whose boards the last discovery found taking no
  // estimates, null before one. It knows a project with no items yet, and a
  // board changed since the index last saw an item.
  unestimating(): ReadonlySet<string> | null;
};

export type JiraBoardsOptions = {
  transport: ReadTransport;
  projects: readonly string[];
  log: Log;
};

export function jiraBoards(options: JiraBoardsOptions): JiraBoards {
  const { transport, log } = options;
  const projects = [...new Set(options.projects)];
  // A failed discovery isn't kept, and only the latest, of two running at
  // once, is.
  let latest: Promise<Map<string, string>> | null = null;
  let unestimating: ReadonlySet<string> | null = null;
  let others = new Map<string, Promise<string | undefined>>();
  const refresh = () => {
    const run: Promise<Map<string, string>> = discoverPoints(transport, projects, log).then(
      (found) => {
        if (latest === run)
          unestimating = new Set(projects.filter((project) => !found.has(project)));
        return found;
      },
      (error: unknown) => {
        if (latest === run) latest = null;
        throw error;
      },
    );
    latest = run;
    others = new Map();
    return run;
  };
  const fields = () => latest ?? refresh();
  return {
    refresh,
    fields,
    async field(project) {
      if (projects.includes(project)) return (await fields()).get(project);
      const known = others.get(project);
      if (known) return known;
      const kept = others;
      const found = discoverPoints(transport, [project], log).then((map) => map.get(project));
      found.catch(() => {
        if (kept.get(project) === found) kept.delete(project);
      });
      kept.set(project, found);
      return found;
    },
    unestimating: () => unestimating,
  };
}
