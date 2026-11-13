// Shared by the source, the writer and the agent's module, so all three give one answer; a board that turns estimation
// on or off is followed from the next sync, without a restart.
import type { Log } from "@oriel/core";
import { discoverPoints } from "./rest.ts";
import type { ReadTransport } from "./transport.ts";

export type JiraBoards = {
  refresh(): Promise<ReadonlyMap<string, string>>;
  fields(): Promise<ReadonlyMap<string, string>>;
  field(project: string): Promise<string | undefined>;
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
