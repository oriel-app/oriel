// Before Oriel keeps a connection the user typed: whether the site takes the
// account's credentials, then whether that account can see the project.
// Nothing is synced or kept here. A request that fails to send throws. The
// first run lists the projects the account can see, so nobody types a
// project key (decision 0038).
import {
  array,
  type Infer,
  nullable,
  number,
  object,
  optional,
  string,
  boolean,
} from "@oriel/core";
import { api, projectKey } from "./rest.ts";
import type { ReadTransport } from "./transport.ts";

export type ConnectionCheck = "ok" | "refused" | "no-project" | "unexpected";

export async function checkConnection(
  transport: ReadTransport,
  project: string,
): Promise<ConnectionCheck> {
  if (!projectKey.test(project)) return "no-project";
  const me = await transport({ method: "GET", path: `${api}/myself` });
  if (me.status === 401 || me.status === 403) return "refused";
  if (me.status !== 200) return "unexpected";
  // Jira answers 404 both for a project that doesn't exist and for one this
  // account can't see.
  const found = await transport({ method: "GET", path: `${api}/project/${project}` });
  if (found.status === 404 || found.status === 403) return "no-project";
  return found.status === 200 ? "ok" : "unexpected";
}

// How many issues a project holds, and when one last changed, as Jira's
// project insight says; either may be missing.
const insight = optional(
  nullable(
    object({ totalIssueCount: optional(number), lastIssueUpdateTime: optional(nullable(string)) }),
  ),
);
const listedProject = object({ key: string, name: string, insight });
const projectPage = object({
  values: array(listedProject),
  isLast: optional(boolean),
  total: optional(number),
});

export type JiraProject = {
  key: string;
  name: string;
  issues: number | null;
  // When an issue in it last changed.
  updatedAt: string | null;
};

const asProject = (listed: Infer<typeof listedProject>): JiraProject => ({
  key: listed.key,
  name: listed.name,
  issues: listed.insight?.totalIssueCount ?? null,
  updatedAt: listed.insight?.lastIssueUpdateTime ?? null,
});

// The projects the account can see, the most recently changed first, from
// the first page of Jira's project search, filtered by `query` when given.
// `more`: Jira has others the page didn't hold, which a query can find.
export async function listProjects(
  transport: ReadTransport,
  query = "",
): Promise<
  | { kind: "ok"; projects: JiraProject[]; more: boolean }
  | { kind: "refused" }
  | { kind: "unexpected" }
> {
  const params = new URLSearchParams({ expand: "insight", maxResults: "100" });
  if (query.trim()) params.set("query", query.trim().slice(0, 100));
  const answer = await transport({ method: "GET", path: `${api}/project/search?${params}` });
  if (answer.status === 401 || answer.status === 403) return { kind: "refused" };
  if (answer.status !== 200) return { kind: "unexpected" };
  const page = projectPage(answer.body);
  if (!page.ok) return { kind: "unexpected" };
  const projects = page.value.values
    .filter((listed) => projectKey.test(listed.key))
    .map(asProject)
    .toSorted(
      (a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || a.key.localeCompare(b.key),
    );
  const more = page.value.isLast === false || (page.value.total ?? 0) > page.value.values.length;
  return { kind: "ok", projects, more };
}

// How many issues one project holds, as Jira's project insight says, or null.
export async function issueCount(
  transport: ReadTransport,
  project: string,
): Promise<number | null> {
  if (!projectKey.test(project)) return null;
  const answer = await transport({
    method: "GET",
    path: `${api}/project/${project}?expand=insight`,
  });
  const read = listedProject(answer.body);
  return answer.status === 200 && read.ok ? (read.value.insight?.totalIssueCount ?? null) : null;
}
