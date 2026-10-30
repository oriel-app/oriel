// For tests: a transport that answers from hand-written payloads, shaped like
// the examples in Atlassian's REST v3 and Agile docs, and keeps every request.
// All names and content are made up.
import type { JiraRequest, JiraResponse, Transport } from "./transport.ts";

export const site = "https://oriel.atlassian.net";
export const pointsField = "customfield_10016";

export type Route = JiraResponse | ((request: JiraRequest) => JiraResponse);

export function fakeJira(routes: Record<string, Route>) {
  const calls: JiraRequest[] = [];
  const transport: Transport = async (request) => {
    calls.push(structuredClone(request));
    const route = routes[`${request.method} ${request.path}`];
    if (!route) throw new Error(`unexpected request: ${request.method} ${request.path}`);
    return structuredClone(typeof route === "function" ? route(request) : route);
  };
  return { transport, calls };
}

export const ok = (body: unknown, status = 200): JiraResponse => ({ status, body });
export const missing: JiraResponse = {
  status: 404,
  body: {
    errorMessages: ["Issue does not exist or you do not have permission to see it."],
    errors: {},
  },
};

// The board list and configuration that discovery reads.
export function discovery(
  project = "SYN",
  estimation: unknown = {
    type: "field",
    field: { fieldId: pointsField, displayName: "Story Points" },
  },
  board = 1,
): Record<string, Route> {
  return {
    [`GET /rest/agile/1.0/board?projectKeyOrId=${project}`]: ok({
      maxResults: 50,
      startAt: 0,
      total: 1,
      isLast: true,
      values: [
        {
          id: board,
          self: `${site}/rest/agile/1.0/board/${board}`,
          name: `${project} board`,
          type: "scrum",
          location: { projectId: 10000, projectKey: project, projectName: "Synthetic" },
        },
      ],
    }),
    [`GET /rest/agile/1.0/board/${board}/configuration`]: ok({
      id: board,
      name: `${project} board`,
      type: "scrum",
      self: `${site}/rest/agile/1.0/board/${board}/configuration`,
      location: { type: "project", key: project, id: "10000" },
      filter: { id: "10000", self: `${site}/rest/api/3/filter/10000` },
      columnConfig: { columns: [{ name: "To Do", statuses: [{ id: "10000" }] }] },
      estimation,
      ranking: { rankCustomFieldId: 10019 },
    }),
  };
}

const issueTypes = {
  Epic: { id: "10000", hierarchyLevel: 1, subtask: false },
  Story: { id: "10001", hierarchyLevel: 0, subtask: false },
  Task: { id: "10002", hierarchyLevel: 0, subtask: false },
  Subtask: { id: "10003", hierarchyLevel: -1, subtask: true },
  Initiative: { id: "10004", hierarchyLevel: 2, subtask: false },
};
export const issueType = (name: keyof typeof issueTypes) => ({
  self: `${site}/rest/api/3/issuetype/${issueTypes[name].id}`,
  description: "",
  iconUrl: `${site}/images/icons/issuetypes/${name.toLowerCase()}.svg`,
  name,
  ...issueTypes[name],
});

const categories = {
  new: { id: 2, colorName: "blue-gray", name: "To Do" },
  indeterminate: { id: 4, colorName: "yellow", name: "In Progress" },
  done: { id: 3, colorName: "green", name: "Done" },
};
export const status = (name: string, category: keyof typeof categories) => ({
  self: `${site}/rest/api/3/status/1`,
  description: "",
  iconUrl: `${site}/images/icons/statuses/generic.png`,
  name,
  id: "1",
  statusCategory: {
    self: `${site}/rest/api/3/statuscategory/1`,
    key: category,
    ...categories[category],
  },
});

export const person = (accountId: string, displayName: string) => ({
  self: `${site}/rest/api/3/user?accountId=${accountId}`,
  accountId,
  avatarUrls: { "48x48": "https://avatar.example.com/48.png" },
  displayName,
  active: true,
  timeZone: "Europe/Lisbon",
  accountType: "atlassian",
});

export const parent = (key: string, type: keyof typeof issueTypes = "Epic") => ({
  id: String(10000 + Number(key.slice(key.indexOf("-") + 1))),
  key,
  self: `${site}/rest/api/3/issue/${key}`,
  fields: {
    summary: `Parent ${key}`,
    status: status("In Progress", "indeterminate"),
    priority: { self: `${site}/rest/api/3/priority/3`, iconUrl: "", name: "Medium", id: "3" },
    issuetype: issueType(type),
  },
});

// A search or issue result. `fields` replaces any default.
export function jiraIssue(key: string, fields: Record<string, unknown> = {}) {
  const id = String(10000 + Number(key.slice(key.indexOf("-") + 1)));
  return {
    expand: "renderedFields,names,schema,operations,editmeta,changelog,versionedRepresentations",
    id,
    self: `${site}/rest/api/3/issue/${id}`,
    key,
    fields: {
      summary: `Summary of ${key}`,
      issuetype: issueType("Story"),
      status: status("To Do", "new"),
      assignee: null,
      labels: [],
      updated: "2026-10-01T12:00:00.000+0100",
      [pointsField]: null,
      ...fields,
    },
  };
}

// A paragraph document, as Jira returns rich text.
export const doc = (...paragraphs: string[]) => ({
  type: "doc",
  version: 1,
  content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
});
