// A stand-in for Atlassian's Rovo MCP server (OA-276), so Jira's support
// through a source server can be built and tried with no Atlassian account:
// it reports the real server's name and tool names, and answers each tool
// from SYN, `fixtures/jira`, in memory, with what the REST call it wraps
// returns, as the real one does, and its search as a page of `nodes`. Writes
// change only this process's copy. Never published, never bundled.
//
// Atlassian documents its tools' names, not their arguments or answers:
// those here are the parser's (`atlassian.ts`), to be checked against the
// real server's (packages/standin-mcp/README.md, "Re-recording"). Served
// over stdio by packages/standin-mcp, and in memory to this package's tests:
// `@oriel/jira/standin`.
import { textToAdf } from "./adf.ts";
import { frozenAt } from "./declared-fixture.ts";
import { loadJiraFixture } from "./fixture.ts";
import { memorySite, memorySiteOrigin } from "./memory-site.ts";

// A tool as a stand-in serves it: as `tools/list` shows it, and its answer
// to a call, failed or not.
export type StandInTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; destructiveHint?: boolean };
  call(args: Record<string, unknown>): Promise<ToolResult>;
};

export type ToolResult = { content: { type: "text"; text: string }[]; isError?: true };

// Its JSON as a tool's text, as the server it stands in for answers.
const ok = (value: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
});
// One short sentence, as a tool that failed answers.
const failed = (words: string): ToolResult => ({
  content: [{ type: "text", text: words }],
  isError: true,
});

// What it reports in its handshake: the name Oriel's entry for the real one
// gives, which Atlassian doesn't document.
export const atlassianInfo = { name: "atlassian-rovo-mcp-server", version: "standin" };

// The one site it reaches, as the resources tool lists it.
export const standInCloudId = "8f3c2a71-5d0e-4b6a-9c1f-2e7d4b8a6f10";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const string = { type: "string" };
const number = { type: "number" };
const schema = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties: { cloudId: string, ...properties },
  required: ["cloudId", ...required],
});

// SYN in memory, as the stand-in starts from.
export const standInSite = () => {
  const fixture = loadJiraFixture();
  return memorySite(fixture, frozenAt(fixture));
};

// Its tools as a caller in this process: what the person's agent would
// answer through it, for tests.
export const standInCaller =
  (tools: readonly StandInTool[] = atlassianStandIn()) =>
  async (call: { tool: string; args: Readonly<Record<string, unknown>> }) => {
    const tool = tools.find((each) => each.name === call.tool);
    if (!tool) throw new Error(`the stand-in has no tool ${call.tool}`);
    return tool.call({ ...call.args });
  };

// The tools it serves, and what each is. Each read is marked read-only, as
// the real server's are; each write isn't.
export function atlassianStandIn(site = standInSite()) {
  // A REST call to the site in memory, as the real tool makes it.
  const rest = async (method: string, path: string, body?: unknown) => {
    const response = await site.fetch(`${memorySiteOrigin}${path}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? (JSON.parse(text) as unknown) : null };
  };
  // Its answer as the tool's: the body, or Jira's own words for a failure.
  const answer = async (
    method: string,
    path: string,
    body?: unknown,
    shape: (body: unknown) => unknown = (value) => value,
  ): Promise<ToolResult> => {
    const response = await rest(method, path, body);
    if (response.status >= 200 && response.status <= 299)
      return ok(response.body === null ? { ok: true } : shape(response.body));
    const words =
      isObject(response.body) && Array.isArray(response.body.errorMessages)
        ? response.body.errorMessages.join(" ")
        : "";
    return failed(`Jira answered ${response.status}. ${words}`.trim());
  };
  const key = (args: Record<string, unknown>) => String(args.issueIdOrKey ?? "");
  const issue = (args: Record<string, unknown>) => `/rest/api/3/issue/${key(args)}`;
  // A rich-text argument as REST takes it: a document as given, text made
  // one.
  const doc = (value: unknown) => (typeof value === "string" ? textToAdf(value) : value);

  const read = (
    name: string,
    description: string,
    properties: Record<string, unknown>,
    required: string[],
    call: (args: Record<string, unknown>) => Promise<ToolResult>,
  ): StandInTool => ({
    name,
    description,
    inputSchema: schema(properties, required),
    annotations: { readOnlyHint: true },
    call,
  });
  const write = (
    name: string,
    description: string,
    properties: Record<string, unknown>,
    required: string[],
    call: (args: Record<string, unknown>) => Promise<ToolResult>,
    destructive = false,
  ): StandInTool => ({
    name,
    description,
    inputSchema: schema(properties, required),
    annotations: { readOnlyHint: false, ...(destructive ? { destructiveHint: true } : {}) },
    call,
  });
  // A tool the real server has that Oriel never calls.
  const unused = (name: string, description: string, readOnly: boolean): StandInTool => ({
    name,
    description,
    inputSchema: schema({}, []),
    annotations: { readOnlyHint: readOnly },
    call: async () => failed(`${name} isn't in the stand-in.`),
  });

  const tools: StandInTool[] = [
    {
      name: "getAccessibleAtlassianResources",
      description: "List the Atlassian sites you can reach, with their cloud IDs.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      call: async () =>
        ok([
          {
            id: standInCloudId,
            url: memorySiteOrigin,
            name: "oriel",
            scopes: ["read:jira-work", "write:jira-work"],
          },
        ]),
    },
    unused("atlassianUserInfo", "Your Atlassian account.", true),
    read(
      "searchJiraIssuesUsingJql",
      "Search work items using JQL.",
      {
        jql: string,
        fields: { type: "array", items: string },
        maxResults: number,
        nextPageToken: string,
      },
      ["jql"],
      async (args) => {
        const asked = Math.min(Math.max(Number(args.maxResults ?? 50) || 50, 1), 100);
        const response = await rest("POST", "/rest/api/3/search/jql", {
          jql: args.jql,
          fields: args.fields,
          maxResults: asked,
          ...(typeof args.nextPageToken === "string" ? { nextPageToken: args.nextPageToken } : {}),
        });
        if (response.status !== 200) return failed(`Jira answered ${response.status}.`);
        const page = response.body as { issues: unknown[]; nextPageToken?: string };
        const at = Number(args.nextPageToken ?? 0) || 0;
        const total = page.nextPageToken ? Number(page.nextPageToken) + 1 : at + page.issues.length;
        return ok({
          issues: {
            totalCount: total,
            nodes: page.issues,
            remainingCount: Math.max(0, total - at - page.issues.length),
            webUrl: `${memorySiteOrigin}/issues?jql=${encodeURIComponent(String(args.jql))}`,
            pageInfo: {
              hasNextPage: page.nextPageToken !== undefined,
              endCursor: page.nextPageToken ?? null,
            },
          },
        });
      },
    ),
    read(
      "getJiraIssue",
      "Fetch a work item by ID or key.",
      { issueIdOrKey: string, fields: { type: "array", items: string }, expand: string },
      ["issueIdOrKey"],
      (args) => {
        const query = new URLSearchParams();
        if (Array.isArray(args.fields)) query.set("fields", args.fields.join(","));
        if (typeof args.expand === "string") query.set("expand", args.expand);
        return answer("GET", `${issue(args)}?${query}`);
      },
    ),
    read(
      "listJiraIssueComments",
      "A work item's comments, paginated.",
      { issueIdOrKey: string, startAt: number, maxResults: number, orderBy: string },
      ["issueIdOrKey"],
      (args) => answer("GET", `${issue(args)}/comment`),
    ),
    read(
      "listJiraIssueRemoteIssueLinks",
      "A work item's remote links.",
      { issueIdOrKey: string },
      ["issueIdOrKey"],
      (args) => answer("GET", `${issue(args)}/remotelink`),
    ),
    read("listJiraBoards", "Boards visible to you.", { projectKeyOrId: string }, [], (args) =>
      answer("GET", `/rest/agile/1.0/board?projectKeyOrId=${String(args.projectKeyOrId ?? "")}`),
    ),
    read(
      "getJiraBoardConfig",
      "A board's settings: its filter, columns and estimation.",
      { boardId: number },
      ["boardId"],
      (args) => answer("GET", `/rest/agile/1.0/board/${Number(args.boardId)}/configuration`),
    ),
    read(
      "listJiraProjectIssueTypesMetadata",
      "The work item types in a space.",
      { projectIdOrKey: string },
      ["projectIdOrKey"],
      (args) =>
        answer("GET", `/rest/api/3/issue/createmeta/${String(args.projectIdOrKey)}/issuetypes`),
    ),
    read(
      "listJiraIssueTransitions",
      "The workflow transitions a work item can take now.",
      { issueIdOrKey: string },
      ["issueIdOrKey"],
      (args) => answer("GET", `${issue(args)}/transitions`),
    ),
    read("getJiraCurrentUser", "The current Jira user.", {}, [], () =>
      answer("GET", "/rest/api/3/myself"),
    ),
    read("listJiraProjects", "The Jira spaces visible to you.", {}, [], () =>
      answer("GET", "/rest/api/3/project/search"),
    ),
    write(
      "createJiraIssue",
      "Create a work item.",
      {
        projectKey: string,
        issueTypeName: string,
        summary: string,
        description: {},
        contentFormat: string,
        parent: string,
        additional_fields: { type: "object" },
      },
      ["projectKey", "issueTypeName", "summary"],
      async (args) => {
        const project = String(args.projectKey);
        const types = await rest("GET", `/rest/api/3/issue/createmeta/${project}/issuetypes`);
        const listed =
          isObject(types.body) && Array.isArray(types.body.issueTypes) ? types.body.issueTypes : [];
        const type = listed.find((each) => isObject(each) && each.name === args.issueTypeName);
        if (!isObject(type)) return failed(`No work item type ${String(args.issueTypeName)}.`);
        return answer("POST", "/rest/api/3/issue", {
          fields: {
            ...(isObject(args.additional_fields) ? args.additional_fields : {}),
            project: { key: project },
            issuetype: { id: type.id },
            summary: args.summary,
            ...(args.description === undefined ? {} : { description: doc(args.description) }),
            ...(typeof args.parent === "string" ? { parent: { key: args.parent } } : {}),
          },
        });
      },
    ),
    write(
      "editJiraIssue",
      "Edit a work item's editable fields.",
      { issueIdOrKey: string, fields: { type: "object" }, contentFormat: string },
      ["issueIdOrKey", "fields"],
      async (args) => {
        const { assignee, description, ...fields } = isObject(args.fields) ? args.fields : {};
        if (assignee !== undefined) {
          const done = await answer("PUT", `${issue(args)}/assignee`, {
            accountId: isObject(assignee) ? assignee.accountId : null,
          });
          if (done.isError || (!Object.keys(fields).length && description === undefined))
            return done;
        }
        return answer("PUT", issue(args), {
          fields: {
            ...fields,
            ...(description === undefined ? {} : { description: doc(description) }),
          },
        });
      },
    ),
    write(
      "transitionJiraIssue",
      "Change a work item's status, or move it to a sprint or the backlog.",
      { issueIdOrKey: string, transition: { type: "object" } },
      ["issueIdOrKey", "transition"],
      (args) => answer("POST", `${issue(args)}/transitions`, { transition: args.transition }),
    ),
    write(
      "addOrEditJiraIssueComment",
      "Add a comment to a work item, or edit one.",
      { issueIdOrKey: string, commentBody: {}, contentFormat: string, commentId: string },
      ["issueIdOrKey", "commentBody"],
      (args) =>
        args.commentId !== undefined
          ? Promise.resolve(failed("Editing a comment isn't in the stand-in."))
          : answer("POST", `${issue(args)}/comment`, { body: doc(args.commentBody) }),
    ),
    write(
      "createJiraIssueRemoteIssueLink",
      "Link a work item to a web page.",
      { issueIdOrKey: string, url: string, title: string },
      ["issueIdOrKey", "url"],
      (args) =>
        answer("POST", `${issue(args)}/remotelink`, {
          object: { url: args.url, title: args.title ?? args.url },
        }),
    ),
    unused("addOrEditJiraIssueWorklog", "Log time on a work item, or edit a worklog.", false),
    unused("createJiraIssueLink", "Link two work items.", false),
    write(
      "deleteJiraIssue",
      "Permanently delete a work item.",
      { issueIdOrKey: string },
      ["issueIdOrKey"],
      (args) => answer("DELETE", issue(args)),
      true,
    ),
    write(
      "deleteJiraComment",
      "Permanently delete a comment.",
      { issueIdOrKey: string, commentId: string },
      ["issueIdOrKey", "commentId"],
      (args) => answer("DELETE", `${issue(args)}/comment/${String(args.commentId)}`),
      true,
    ),
  ];
  // Every call names the one site it reaches.
  return tools.map((tool): StandInTool =>
    tool.name === "getAccessibleAtlassianResources"
      ? tool
      : {
          ...tool,
          call: async (args) =>
            args.cloudId === standInCloudId
              ? tool.call(args)
              : failed("That cloud ID isn't a site you can reach."),
        },
  );
}
