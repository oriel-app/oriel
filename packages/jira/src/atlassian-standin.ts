// A stand-in for Atlassian's Rovo MCP server (OA-276), so Jira's support
// through a source server can be built and tried with no Atlassian account:
// it reports the real server's name and lists the tools it lists flat at
// the address Atlassian's instructions give, with the operations Oriel runs
// through `executeRead` and `executeWrite`, and answers each from SYN,
// `fixtures/jira`, in memory, in the real server's shapes, as recorded in
// fixtures/jira-mcp/real.json: JSON under `data`, the "full" view's, rich
// text as Markdown, custom fields by their labels, and a failure as
// `{"error": true, "message", "statusCode"}`. Writes change only this
// process's copy. Never published, never bundled. Served over stdio by
// packages/standin-mcp, and in memory to this package's tests:
// `@oriel/jira/standin`.
import { type StandInAnswer, type StandInTool, standInCalls } from "@oriel/core";
import { adfToText, textToAdf } from "./adf.ts";
import { fromMarkdown, toMarkdown } from "./atlassian.ts";
import { frozenAt } from "./declared-fixture.ts";
import { loadJiraFixture } from "./fixture.ts";
import { memorySite, memorySiteOrigin } from "./memory-site.ts";

// A tool as a stand-in serves it, and its answer, as core gives them.
export type { StandInTool } from "@oriel/core";
type ToolResult = StandInAnswer;

// Its value as a tool's text, under `data`, as the real server answers.
const ok = (value: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify({ data: value }) }],
});
// A failure, as the real server answers one: its words and REST's status.
const failed = (message: string, statusCode = 400): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify({ error: true, message, statusCode }) }],
  isError: true,
});

// What it reports in its handshake, as the real one does.
export const atlassianInfo = { name: "atlassian-mcp-server", version: "standin" };

// The one site it reaches, as the resources tool lists it.
export const standInCloudId = "8f3c2a71-5d0e-4b6a-9c1f-2e7d4b8a6f10";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const string = { type: "string" };
const number = { type: "number" };
const object = { type: "object" };
const schema = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties: { cloudId: string, ...properties },
  required: ["cloudId", ...required],
});

// An issue as the real server gives one: its description in Markdown, and
// each custom field by a label, with its ID and value.
const asServer = (raw: unknown): unknown => {
  if (!isObject(raw) || !isObject(raw.fields)) return raw;
  const fields: Record<string, unknown> = {};
  const customFields: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(raw.fields)) {
    if (/^customfield_[0-9]+$/.test(name))
      customFields[`Field ${name.slice("customfield_".length)}`] =
        value === null || value === undefined ? { id: name } : { id: name, value };
    else if (name === "description")
      fields.description = value === null ? null : toMarkdown(adfToText(value));
    else fields[name] = value;
  }
  return {
    ...raw,
    fields: { ...fields, ...(Object.keys(customFields).length ? { customFields } : {}) },
  };
};
const commentAsServer = (raw: unknown): unknown =>
  isObject(raw) ? { ...raw, body: toMarkdown(adfToText(raw.body)) } : raw;

// SYN in memory, as the stand-in starts from.
export const standInSite = () => {
  const fixture = loadJiraFixture();
  return memorySite(fixture, frozenAt(fixture));
};

// Its tools as a caller in this process: what the person's agent would
// answer through it, for tests.
export const standInCaller = (tools: readonly StandInTool[] = atlassianStandIn()) =>
  standInCalls(tools);

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
      return ok(response.body === null ? {} : shape(response.body));
    const words =
      isObject(response.body) && Array.isArray(response.body.errorMessages)
        ? response.body.errorMessages.join(" ")
        : "";
    return failed(words || `Jira answered ${response.status}.`, response.status);
  };
  const key = (args: Record<string, unknown>) => String(args.issueIdOrKey ?? "");
  const issue = (args: Record<string, unknown>) => `/rest/api/3/issue/${key(args)}`;
  // A rich-text argument as REST takes it: Markdown made a document.
  const doc = (value: unknown) =>
    typeof value === "string" ? textToAdf(fromMarkdown(value)) : value;

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
  ): StandInTool => ({
    name,
    description,
    inputSchema: schema(properties, required),
    annotations: { readOnlyHint: false },
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

  // The operations `executeRead` runs by name, as the real one's discover
  // names them: only those Oriel runs.
  const operations: Record<string, (inputs: Record<string, unknown>) => Promise<ToolResult>> = {
    listJiraIssueRemoteIssueLinks: (inputs) => answer("GET", `${issue(inputs)}/remotelink`),
    listJiraBoards: (inputs) =>
      answer(
        "GET",
        `/rest/agile/1.0/board?projectKeyOrId=${String(inputs.projectKeyOrId ?? "")}`,
        undefined,
        (body) => ({ startAt: 0, total: listed(body).length, isLast: true, values: listed(body) }),
      ),
    getJiraBoardConfig: (inputs) =>
      answer("GET", `/rest/agile/1.0/board/${Number(inputs.boardId)}/configuration`),
    listJiraProjectIssueTypesMetadata: (inputs) =>
      answer(
        "GET",
        `/rest/api/3/issue/createmeta/${String(inputs.projectIdOrKey)}/issuetypes`,
        undefined,
        (body) => ({ ...(body as object), startAt: 0 }),
      ),
    listJiraIssueTransitions: (inputs) => answer("GET", `${issue(inputs)}/transitions`),
    getJiraCurrentUser: () => answer("GET", "/rest/api/3/myself"),
    listJiraProjects: () => answer("GET", "/rest/api/3/project/search"),
  };
  const writeOperations: Record<string, (inputs: Record<string, unknown>) => Promise<ToolResult>> =
    {
      createJiraIssueRemoteIssueLink: (inputs) =>
        answer("POST", `${issue(inputs)}/remotelink`, {
          object: { url: inputs.url, title: inputs.title ?? inputs.url },
        }),
    };
  const execute = (
    name: string,
    description: string,
    known: Record<string, (inputs: Record<string, unknown>) => Promise<ToolResult>>,
    readOnly: boolean,
  ): StandInTool => ({
    name,
    description,
    inputSchema: schema({ name: string, inputs: object }, ["name"]),
    annotations: { readOnlyHint: readOnly },
    call: async (args) => {
      const run = known[String(args.name)];
      if (!run) return failed(`Unknown operation ${String(args.name)}.`, 400);
      return run(isObject(args.inputs) ? args.inputs : {});
    },
  });

  const tools: StandInTool[] = [
    {
      name: "getAccessibleAtlassianResources",
      description: "Returns the cloudId(s) available to the current user.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      call: async () =>
        ok({
          resources: [
            {
              cloudId: standInCloudId,
              url: memorySiteOrigin,
              products: [{ id: "jira", access: "read-write" }],
            },
          ],
        }),
    },
    unused("atlassianUserInfo", "Your Atlassian account.", true),
    read(
      "searchJiraIssuesUsingJql",
      "Search for Jira issues using JQL.",
      {
        jql: string,
        fields: { type: "array", items: {} },
        maxResults: number,
        nextPageToken: string,
        view: string,
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
        if (response.status !== 200)
          return failed(`Failed to search issues: ${response.status}`, response.status);
        const page = response.body as { issues: unknown[]; nextPageToken?: string };
        return ok({
          issues: page.issues.map(asServer),
          ...(page.nextPageToken === undefined ? {} : { nextPageToken: page.nextPageToken }),
          isLast: page.nextPageToken === undefined,
          appliedContentFormat: "markdown",
        });
      },
    ),
    read(
      "getJiraIssue",
      "Get a Jira or JSM issue by key or ID.",
      { issueIdOrKey: string, fields: { type: "array", items: {} }, expand: string, view: string },
      ["issueIdOrKey"],
      (args) => {
        const query = new URLSearchParams();
        if (Array.isArray(args.fields)) query.set("fields", args.fields.join(","));
        if (typeof args.expand === "string") query.set("expand", args.expand);
        return answer("GET", `${issue(args)}?${query}`, undefined, (body) => ({
          ...(asServer(body) as object),
          appliedContentFormat: "markdown",
        }));
      },
    ),
    read(
      "listJiraIssueComments",
      "Get a paginated list of comments for a Jira issue.",
      {
        issueIdOrKey: string,
        startAt: { type: "integer" },
        maxResults: { type: "integer" },
        orderBy: string,
        view: string,
      },
      ["issueIdOrKey"],
      (args) =>
        answer("GET", `${issue(args)}/comment`, undefined, (body) => {
          const all = isObject(body) && Array.isArray(body.comments) ? body.comments : [];
          const at = Math.max(Number(args.startAt ?? 0) || 0, 0);
          const most = Math.min(Math.max(Number(args.maxResults ?? 100) || 100, 1), 100);
          const page = all.slice(at, at + most);
          return {
            startAt: at,
            maxResults: most,
            total: all.length,
            isLast: at + page.length >= all.length,
            appliedContentFormat: "markdown",
            comments: page.map(commentAsServer),
          };
        }),
    ),
    write(
      "createJiraIssue",
      "Create a new Jira issue.",
      {
        projectKey: string,
        issueType: string,
        summary: string,
        description: string,
        contentFormat: string,
        parent: string,
        additional_fields: object,
      },
      ["projectKey", "issueType", "summary"],
      async (args) => {
        const project = String(args.projectKey);
        const types = await rest("GET", `/rest/api/3/issue/createmeta/${project}/issuetypes`);
        const listedTypes =
          isObject(types.body) && Array.isArray(types.body.issueTypes) ? types.body.issueTypes : [];
        const type = listedTypes.find((each) => isObject(each) && each.name === args.issueType);
        if (!isObject(type)) return failed(`No issue type ${String(args.issueType)}.`);
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
      "Update a Jira issue's fields.",
      { issueIdOrKey: string, fields: object, contentFormat: string },
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
      "Transition a Jira issue to a new workflow status.",
      { issueIdOrKey: string, transitionId: string },
      ["issueIdOrKey"],
      (args) =>
        answer("POST", `${issue(args)}/transitions`, {
          transition: { id: String(args.transitionId) },
        }),
    ),
    write(
      "addOrEditJiraIssueComment",
      "Add a comment to a Jira issue, or edit one.",
      { issueIdOrKey: string, commentBody: string, contentFormat: string, commentId: string },
      ["issueIdOrKey"],
      (args) =>
        args.commentId !== undefined
          ? Promise.resolve(failed("Editing a comment isn't in the stand-in."))
          : answer("POST", `${issue(args)}/comment`, { body: doc(args.commentBody) }),
    ),
    unused("discover", "Find Atlassian operations that are not already in your tool list.", true),
    execute("executeRead", "Run a read-only Atlassian operation by name.", operations, true),
    execute("executeWrite", "Run a write Atlassian operation by name.", writeOperations, false),
    {
      ...unused("executeDestructive", "Run a destructive Atlassian operation by name.", false),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    unused("search", "Search Jira and Confluence.", true),
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
              : failed("That cloud ID isn't a site you can reach.", 404),
        },
  );
}

// A REST listing's values.
const listed = (body: unknown): unknown[] =>
  isObject(body) && Array.isArray(body.values) ? body.values : [];
