// For tests: SYN as a Jira site in memory, answering the REST calls the
// writer makes over `fetch`, so a composition root can be tested writing
// without a network. It starts from the fixture after its source edits, with
// the same stable IDs the index has. Every write moves the item's `updated`
// one second on from `clock`. Exported as `@oriel/jira/testing`.
import type { Instant } from "@oriel/core";
import { instant } from "@oriel/core";
import { adfToText, textToAdf } from "./adf.ts";
import { applySourceEdits, type JiraFixture } from "./fixture.ts";

export const memorySiteOrigin = "https://oriel.atlassian.net";
const pointsField = "customfield_10016";

type Issue = {
  id: string;
  key: string;
  issueType: string;
  summary: string;
  description: string;
  epic: string | null;
  assignee: string | null;
  points: number | null;
  links: { linkId: string; url: string; title: string }[];
  updated: Instant;
};

export type MemorySite = ReturnType<typeof memorySite>;

export function memorySite(fixture: JiraFixture, clock: Instant) {
  const { issues: start } = applySourceEdits(fixture, fixture.edits.length);
  const issues = new Map<string, Issue>(
    start.map((issue) => [
      issue.key,
      {
        id: issue.id,
        key: issue.key,
        issueType: issue.issueType,
        summary: issue.summary,
        description: issue.description,
        epic: issue.epic,
        assignee: issue.assignee,
        points: issue.points,
        links: issue.links.map((link) => ({ ...link })),
        updated: issue.updatedAt,
      },
    ]),
  );
  const people = new Map(fixture.people.map((person) => [person.id, person.displayName]));
  const project = fixture.project.key;
  let ticks = 0;
  let nextIssue = 900;
  let nextLink = 90001;
  // Items whose writes Jira refuses, as when a field is locked.
  const refused = new Set<string>();
  // Every request, in order.
  const calls: { method: string; path: string }[] = [];

  const tick = (): Instant => {
    ticks += 1;
    return instant(new Date(Date.parse(clock) + ticks * 1000));
  };
  const json = (status: number, body?: unknown) =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  const missing = () =>
    json(404, { errorMessages: ["Issue does not exist or you do not have permission to see it."] });
  const type = (name: string) => ({
    id: name === "Epic" ? "10000" : "10001",
    name,
    subtask: false,
    hierarchyLevel: name === "Epic" ? 1 : 0,
  });
  const view = (issue: Issue) => ({
    id: issue.id,
    key: issue.key,
    fields: {
      summary: issue.summary,
      description: issue.description ? textToAdf(issue.description) : null,
      issuetype: type(issue.issueType),
      parent: issue.epic ? { id: issues.get(issue.epic)?.id ?? "1", key: issue.epic } : undefined,
      assignee: issue.assignee
        ? { accountId: issue.assignee, displayName: people.get(issue.assignee) ?? issue.assignee }
        : null,
      updated: issue.updated,
      [pointsField]: issue.points,
    },
  });

  const answer = (method: string, url: URL, body: unknown): Response => {
    const path = url.pathname;
    if (method === "GET" && path === "/rest/agile/1.0/board")
      return json(200, { values: [{ id: 1, type: "scrum" }] });
    if (method === "GET" && path === "/rest/agile/1.0/board/1/configuration")
      return json(200, {
        estimation: { type: "field", field: { fieldId: pointsField, displayName: "Story Points" } },
      });
    if (method === "GET" && path === `/rest/api/3/issue/createmeta/${project}/issuetypes`)
      return json(200, { issueTypes: [{ id: "10001", name: "Story", subtask: false }] });
    if (method === "POST" && path === "/rest/api/3/issue") {
      const fields = (body as { fields: Record<string, unknown> }).fields;
      const parent = fields.parent as { key: string } | undefined;
      const issue: Issue = {
        id: String(20000 + nextIssue),
        key: `${project}-${nextIssue}`,
        issueType: "Story",
        summary: String(fields.summary),
        description: fields.description ? adfToText(fields.description) : "",
        epic: parent?.key ?? null,
        assignee: null,
        points: typeof fields[pointsField] === "number" ? (fields[pointsField] as number) : null,
        links: [],
        updated: tick(),
      };
      nextIssue += 1;
      issues.set(issue.key, issue);
      return json(201, { id: issue.id, key: issue.key });
    }
    const match =
      /^\/rest\/api\/3\/issue\/([A-Z][A-Z0-9_]*-[0-9]+)(\/assignee|\/remotelink(?:\/([0-9]+))?)?$/.exec(
        path,
      );
    const issue = match?.[1] ? issues.get(match[1]) : undefined;
    if (!match || !issue) return missing();
    const [, key = "", sub, linkId] = match;
    if (method !== "GET" && refused.has(key))
      return json(400, { errorMessages: [`${key} can't be changed right now`], errors: {} });
    if (sub === undefined) {
      if (method === "GET") return json(200, view(issue));
      if (method === "DELETE") {
        issues.delete(key);
        return json(204);
      }
      if (method === "PUT") {
        const fields = (body as { fields: Record<string, unknown> }).fields;
        if ("summary" in fields) issue.summary = String(fields.summary);
        if ("description" in fields) issue.description = adfToText(fields.description);
        if (pointsField in fields)
          issue.points =
            typeof fields[pointsField] === "number" ? (fields[pointsField] as number) : null;
        issue.updated = tick();
        return json(204);
      }
    }
    if (sub === "/assignee" && method === "PUT") {
      issue.assignee = (body as { accountId: string | null }).accountId;
      issue.updated = tick();
      return json(204);
    }
    if (sub?.startsWith("/remotelink")) {
      const link = issue.links.find((l) => l.linkId === linkId);
      if (method === "GET")
        return link
          ? json(200, { id: Number(link.linkId), object: { url: link.url, title: link.title } })
          : json(404, {});
      if (method === "POST" && linkId === undefined) {
        const { object } = body as { object: { url: string; title: string } };
        const made = { linkId: String(nextLink), url: object.url, title: object.title };
        nextLink += 1;
        issue.links.push(made);
        issue.updated = tick();
        return json(201, { id: Number(made.linkId) });
      }
      if (method === "DELETE" && link) {
        issue.links = issue.links.filter((l) => l !== link);
        issue.updated = tick();
        return json(204);
      }
    }
    return json(405, { errorMessages: [`${method} ${path} isn't something this site answers`] });
  };

  const fetchFn: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== memorySiteOrigin) throw new Error(`no route to ${url.origin}`);
    const method = init?.method ?? "GET";
    calls.push({ method, path: `${url.pathname}${url.search}` });
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    return answer(method, url, body);
  };

  return {
    fetch: fetchFn,
    calls,
    // The item as the site holds it now.
    issue: (key: string) => structuredClone(issues.get(key) ?? null),
    // Writes to this item fail from now on, or work again.
    refuse: (key: string) => refused.add(key),
    allow: (key: string) => refused.delete(key),
    // A teammate edits the item directly in Jira.
    edit(key: string, change: Partial<Pick<Issue, "summary" | "points">>) {
      const issue = issues.get(key);
      if (!issue) throw new Error(`no issue ${key}`);
      Object.assign(issue, change, { updated: tick() });
    },
  };
}
