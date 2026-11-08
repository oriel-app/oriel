// Jira through Atlassian's own MCP server (decision 0059, OA-276): the entry
// Oriel knows it by, and the parser, both ways. The parser is a transport:
// each REST request the source, its boards and the writer make becomes one
// call of the server's tools, and the tool's answer becomes the REST body
// they already check, so everything they do works the same through it. A
// request with no tool to answer it is refused before anything is sent.
//
// At the address Atlassian's own instructions give, the server lists a few
// Jira tools flat, and reaches the rest by name through `executeRead` and
// `executeWrite` (`discover` names them; Oriel's are fixed, below). Its
// answers are JSON under `data`, in the "full" view, with rich text as
// Markdown and custom fields by their labels; a failed one says so under
// `error`, with REST's status. What isn't so stops the sync, naming the
// server (`ServerUnreadable`): the index stays as it was. Recorded from the
// real server in fixtures/jira-mcp/real.json.
// https://support.atlassian.com/atlassian-rovo-mcp-server/docs/supported-tools/
import {
  answerText,
  narrowed,
  type SourceServer,
  ServerUnreadable,
  type ToolAnswer,
  type ToolCall,
  type ToolCaller,
  WriteStalled,
} from "@oriel/core";
import { adfToText, textToAdf } from "./adf.ts";
import {
  type JiraRequest,
  type JiraResponse,
  type ReadRequest,
  type ReadTransport,
  searchPath,
  type Transport,
} from "./transport.ts";

// Its tools Oriel calls, by what each does.
export const atlassianTools = {
  resources: "getAccessibleAtlassianResources",
  search: "searchJiraIssuesUsingJql",
  issue: "getJiraIssue",
  comments: "listJiraIssueComments",
  executeRead: "executeRead",
  create: "createJiraIssue",
  edit: "editJiraIssue",
  transition: "transitionJiraIssue",
  comment: "addOrEditJiraIssueComment",
  executeWrite: "executeWrite",
} as const;

// The operations Oriel runs through `executeRead` and `executeWrite`, by
// what each does: only these, each through its own, so the read side can
// run no write, and nothing runs `executeDestructive`, which Oriel never
// loads. Atlassian's server has no operation to delete an issue, a comment
// or a link, so a revert that would is refused before anything is sent.
export const atlassianOperations = {
  links: "listJiraIssueRemoteIssueLinks",
  boards: "listJiraBoards",
  board: "getJiraBoardConfig",
  types: "listJiraProjectIssueTypesMetadata",
  transitions: "listJiraIssueTransitions",
  me: "getJiraCurrentUser",
  projects: "listJiraProjects",
} as const;
export const atlassianWriteOperations = { link: "createJiraIssueRemoteIssueLink" } as const;

type ReadOperation = (typeof atlassianOperations)[keyof typeof atlassianOperations];
type WriteOperation = (typeof atlassianWriteOperations)[keyof typeof atlassianWriteOperations];
const readOperations: readonly string[] = Object.values(atlassianOperations);
const writeOperations: readonly string[] = Object.values(atlassianWriteOperations);

const t = atlassianTools;
const o = atlassianOperations;

// The view every read asks for: the default leaves out fields Oriel asks
// for, such as an issue's parent and description.
const view = "full";

// One run of an operation by its name, as `executeRead` or `executeWrite`
// takes it, with the site it's on.
export const operationCall = (
  cloudId: string,
  name: ReadOperation | WriteOperation,
  inputs: Record<string, unknown>,
): ToolCall => {
  // Checked at run time too, so a cast can't run another operation.
  const tool = writeOperations.includes(name)
    ? t.executeWrite
    : readOperations.includes(name)
      ? t.executeRead
      : null;
  if (!tool) throw new Error(`refusing an operation Oriel doesn't run: ${name}`);
  return { tool, args: { cloudId, name, inputs } };
};

// Atlassian's MCP server, as Oriel knows it: at its address, whatever it
// lists beyond Oriel's tools, and an address compares without its query,
// so one added with `?tools=all` is it too.
export const atlassianServer: SourceServer = {
  name: "Atlassian's Rovo MCP server",
  reports: "atlassian-mcp-server",
  at: { url: "https://mcp.atlassian.com/v2/mcp" },
  reads: [t.resources, t.search, t.issue, t.comments, t.executeRead],
  writes: [t.create, t.edit, t.transition, t.comment, t.executeWrite],
  instructions:
    "https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/",
  // The project a connection reads, from those the server lists on its site.
  picks: [
    {
      name: "project",
      label: "Project",
      unpicked: "the first project it lists",
      async list(read, query, connection) {
        const named = URL.canParse(connection.identity)
          ? new URL(connection.identity).origin
          : null;
        const site = siteOf(await read({ tool: t.resources, args: {} }), named);
        if (!site) return { choices: [], more: false };
        // Page by page, as REST's project search pages, at most 10 pages.
        const projects: ReturnType<typeof projectChoicesOf> = [];
        for (let page = 0; page < 10; page++) {
          const answer = await read(
            operationCall(site.cloudId, o.projects, {
              expand: "insight",
              ...(projects.length ? { startAt: projects.length } : {}),
            }),
          );
          const listed = projectChoicesOf(answer);
          projects.push(...listed);
          const body = bodyOf(o.projects, answer).body;
          if (!listed.length || !isObject(body) || body.isLast !== false) break;
        }
        return narrowed(
          projects.map(({ key, ...each }) => ({ value: key, ...each })),
          query,
        );
      },
    },
  ],
};

// A tool's answer Oriel can't read: core's, so every connector's sync
// stops the same way.
export { ServerUnreadable };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// A failed tool's words as the status REST would have answered, so the
// source reads a missing issue as gone and the writer a refusal as nothing
// changed. Only words that say so are a refusal: a write that failed for a
// reason it doesn't give may have landed, so it reads as a server's error;
// a read that did reads as a refusal, which stops it either way.
function statusOf(words: string, write: boolean): number {
  // A status as the words name one, never a number an issue's key holds.
  const code = /\b(?:status|http|answered|code|error)\W{0,3}([45]\d\d)\b/i.exec(words)?.[1];
  if (code) return Number(code);
  if (/\b(unauthori[sz]ed|not authenticated|sign(ed)? ?in)\b/i.test(words)) return 401;
  if (/\b(does not exist|not found|no such|can ?not find)\b/i.test(words)) return 404;
  if (/\b(forbidden|permission)\b/i.test(words)) return 403;
  if (/\b(rate limit|too many requests)\b/i.test(words)) return 429;
  return write ? 502 : 400;
}

// A failure as the server gives one: `{"error": true, "message", "statusCode"}`.
function failedWith(words: string, write: boolean): JiraResponse {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(words) as unknown;
  } catch {
    // Words alone.
  }
  const given = isObject(parsed) ? parsed.statusCode : undefined;
  const message = isObject(parsed) && typeof parsed.message === "string" ? parsed.message : words;
  const status =
    typeof given === "number" && Number.isInteger(given) && given >= 400 && given <= 599
      ? given
      : statusOf(message, write);
  return { status, body: { errorMessages: [message.slice(0, 300)] } };
}

// A tool's answer as a REST response: what its text gives under `data`, or,
// for a failed one, the status it names. Its structured content, where an
// agent passes it on, isn't read: it holds another shape than the text, and
// Claude Code passes on the text alone.
export function bodyOf(tool: string, answer: ToolAnswer, write = false): JiraResponse {
  if (!isObject(answer) || !Array.isArray(answer.content))
    throw new ServerUnreadable(`${tool} answered with no content`);
  const words = answerText(answer);
  if (answer.isError === true) return failedWith(words, write);
  let parsed: unknown;
  try {
    parsed = JSON.parse(words) as unknown;
  } catch {
    throw new ServerUnreadable(`${tool} answered with text that isn't JSON`);
  }
  if (isObject(parsed) && parsed.error === true) return failedWith(words, write);
  if (!isObject(parsed) || !("data" in parsed))
    throw new ServerUnreadable(`${tool} answered without its data`);
  return { status: 200, body: parsed.data };
}

// A list a tool may answer as itself or inside an object, as REST's `values`.
const listOf = (body: unknown, key: string): unknown[] | null =>
  Array.isArray(body)
    ? body
    : isObject(body) && Array.isArray(body[key])
      ? (body[key] as unknown[])
      : null;

// Rich text as the server gives it, Markdown, as the plain text it holds:
// a line break as a newline, and each mark it escaped as itself.
export const fromMarkdown = (markdown: string): string =>
  markdown.replace(/ {2}\n/g, "\n").replace(/\\([\\`*_{}[\]()#+\-.!|~<>=])/g, "$1");

// Plain text as the server's Markdown takes it, so it lands as the text the
// person approved: every mark escaped, and a line break as Markdown's.
export const toMarkdown = (text: string): string =>
  text
    .replace(/[\\`*_{}[\]()#+\-.!|~<>=]/g, (mark) => `\\${mark}`)
    .replace(/([^\n])\n(?=[^\n])/g, "$1  \n");

// Rich text as REST gives it, a document, from the server's Markdown.
const docOf = (value: unknown): unknown =>
  typeof value === "string" ? textToAdf(fromMarkdown(value)) : value;

// An issue as REST gives it: its description a document, and each custom
// field under its ID, as the server gives them by their labels.
function restIssue(tool: string, raw: unknown): unknown {
  if (!isObject(raw) || !isObject(raw.fields)) return raw;
  const { customFields, description, ...fields } = raw.fields;
  const custom: Record<string, unknown> = {};
  if (customFields !== undefined) {
    if (!isObject(customFields))
      throw new ServerUnreadable(`${tool} gave custom fields it can't read`);
    for (const each of Object.values(customFields)) {
      if (!isObject(each) || typeof each.id !== "string" || !/^customfield_[0-9]+$/.test(each.id))
        throw new ServerUnreadable(`${tool} gave a custom field without its ID`);
      custom[each.id] = each.value ?? null;
    }
  }
  return {
    ...raw,
    fields: {
      ...fields,
      ...custom,
      ...(description === undefined ? {} : { description: docOf(description) }),
    },
  };
}

// A comment as REST gives it, its body a document.
const restComment = (raw: unknown): unknown =>
  isObject(raw) && "body" in raw ? { ...raw, body: docOf(raw.body) } : raw;

// The search's answer as REST's: its issues, and the token for the next
// page, or none on the last. One that says more remain but gives no way to
// them can't be read: a sweep that stopped there would take the rest away.
export function searchBody(body: unknown): unknown {
  if (!isObject(body) || !Array.isArray(body.issues))
    throw new ServerUnreadable(`${t.search} answered with no issues`);
  const more = () =>
    new ServerUnreadable(`${t.search} said more issues remain, with no way to them`);
  const given = body.nextPageToken;
  if (given !== undefined && given !== null && (typeof given !== "string" || given === ""))
    throw more();
  const token = typeof given === "string" ? given : null;
  if (token === null && body.isLast === false) throw more();
  return {
    issues: body.issues.map((each) => restIssue(t.search, each)),
    nextPageToken: token,
    isLast: token === null,
  };
}

const issuePath = /^\/rest\/api\/3\/issue\/([A-Z][A-Z0-9_]*-[0-9]+)(\/[a-z]+(?:\/[0-9]+)?)?$/;

// What a request asks, parsed: its path without the query, and the query.
const partsOf = (path: string) => {
  const url = new URL(path, "https://jira.invalid");
  return { path: url.pathname, query: url.searchParams };
};

// A REST body's `fields` as the server's edit takes them: a description as
// Markdown, everything else as REST has it.
const fieldsOf = (body: unknown): Record<string, unknown> => {
  const fields = isObject(body) && isObject(body.fields) ? body.fields : {};
  return "description" in fields
    ? { ...fields, description: toMarkdown(adfToText(fields.description)) }
    : fields;
};

// The page size Oriel asks a comment listing for: the most the full view
// gives.
const commentPage = 20;

// What answers a request no tool does: as Jira refuses a request it can't
// take, with nothing sent.
const noTool = (what: string): JiraResponse => ({
  status: 405,
  body: { errorMessages: [`Atlassian's server has no tool to ${what}`] },
});

export type AtlassianOptions = {
  // The site's cloud ID, as its resources tool gives it, which every call
  // names.
  cloudId: string;
  read: ToolCaller;
  // A change set's replay; absent on the read side.
  write?: ToolCaller;
};

// Jira's REST requests answered through Atlassian's server: reads through
// `read`, writes through `write`. Each issue type's name, which its create
// takes in place of REST's ID, comes from the last listing of them.
export function atlassianTransport(options: AtlassianOptions): Transport {
  const { cloudId } = options;
  const typeNames = new Map<string, string>();

  const ask = async (
    caller: ToolCaller | undefined,
    call: ToolCall,
    write: boolean,
  ): Promise<JiraResponse> => {
    if (!caller) throw new Error(`refusing a write on the read side: ${call.tool}`);
    const name = typeof call.args.name === "string" ? call.args.name : call.tool;
    return bodyOf(name, await caller(call), write);
  };
  const read = (tool: string, args: Record<string, unknown>) =>
    ask(options.read, { tool, args: { cloudId, ...args } }, false);
  const run = (name: ReadOperation, inputs: Record<string, unknown>) =>
    ask(options.read, operationCall(cloudId, name, inputs), false);
  const write = (tool: string, args: Record<string, unknown>) =>
    ask(options.write, { tool, args: { cloudId, ...args } }, true);
  // A read whose answer is reshaped into REST's, unless it failed.
  const reshaped = async (
    response: Promise<JiraResponse>,
    shape: (body: unknown) => unknown,
  ): Promise<JiraResponse> => {
    const answered = await response;
    return answered.status === 200 ? { status: 200, body: shape(answered.body) } : answered;
  };
  const list = (tool: string, key: string) => (body: unknown) => {
    const found = listOf(body, key);
    if (!found) throw new ServerUnreadable(`${tool} answered with no ${key}`);
    return found;
  };
  // Every comment on an issue, page by page, as REST's one page.
  const comments = async (key: string): Promise<JiraResponse> => {
    const all: unknown[] = [];
    for (;;) {
      const page = await read(t.comments, {
        issueIdOrKey: key,
        startAt: all.length,
        maxResults: commentPage,
        orderBy: "created",
        view,
      });
      if (page.status !== 200) return page;
      const listed = list(t.comments, "comments")(page.body).map(restComment);
      all.push(...listed);
      const total =
        isObject(page.body) && typeof page.body.total === "number" ? page.body.total : 0;
      if (!listed.length || all.length >= total) return { status: 200, body: all };
    }
  };
  const one = (found: JiraResponse, id: string, what: string): JiraResponse => {
    if (found.status !== 200) return found;
    const match = (found.body as unknown[]).find(
      (each) => isObject(each) && String(each.id) === id,
    );
    return match === undefined
      ? { status: 404, body: { errorMessages: [`No ${what} ${id}`] } }
      : { status: 200, body: match };
  };
  // A write the server has no operation for: nothing is sent.
  const cannot = (what: string): never => {
    throw new WriteStalled(`Atlassian's server has no tool to ${what}`);
  };

  return async (request: JiraRequest): Promise<JiraResponse> => {
    const { path, query } = partsOf(request.path);
    const { method, body } = request;
    if (method === "POST" && path === searchPath) {
      const asked = isObject(body) ? body : {};
      return reshaped(
        read(t.search, {
          jql: asked.jql,
          fields: asked.fields,
          maxResults: asked.maxResults,
          view,
          ...(typeof asked.nextPageToken === "string"
            ? { nextPageToken: asked.nextPageToken }
            : {}),
        }),
        searchBody,
      );
    }
    if (method === "GET" && path === "/rest/api/3/myself") return run(o.me, {});
    if (method === "GET" && path === "/rest/agile/1.0/board")
      return reshaped(
        run(o.boards, { projectKeyOrId: query.get("projectKeyOrId") ?? "" }),
        (listed) => ({ values: list(o.boards, "values")(listed) }),
      );
    const board = /^\/rest\/agile\/1\.0\/board\/([0-9]+)\/configuration$/.exec(path);
    if (method === "GET" && board) return run(o.board, { boardId: Number(board[1]) });
    const types = /^\/rest\/api\/3\/issue\/createmeta\/([A-Z][A-Z0-9_]*)\/issuetypes$/.exec(path);
    if (method === "GET" && types)
      return reshaped(run(o.types, { projectIdOrKey: types[1] }), (listed) => {
        const issueTypes = list(o.types, "issueTypes")(listed);
        for (const type of issueTypes)
          if (isObject(type) && typeof type.id === "string" && typeof type.name === "string")
            typeNames.set(type.id, type.name);
        return { issueTypes };
      });
    if (method === "POST" && path === "/rest/api/3/issue") {
      const fields = fieldsOf(body);
      const { project, issuetype, summary, description, parent, ...more } = fields;
      const typeId = isObject(issuetype) ? String(issuetype.id) : "";
      const typeName = typeNames.get(typeId);
      if (typeName === undefined)
        return { status: 400, body: { errorMessages: [`No issue type ${typeId} listed`] } };
      return write(t.create, {
        projectKey: isObject(project) ? project.key : undefined,
        issueType: typeName,
        summary,
        ...(description === undefined ? {} : { description, contentFormat: "markdown" }),
        ...(isObject(parent) ? { parent: parent.key } : {}),
        ...(Object.keys(more).length ? { additional_fields: more } : {}),
      });
    }
    const match = issuePath.exec(path);
    if (!match) return noTool(`answer ${method} ${path}`);
    const [, key = "", sub = ""] = match;
    const [, part = "", id = ""] = /^\/([a-z]+)(?:\/([0-9]+))?$/.exec(sub) ?? [];
    const issueIdOrKey = key;
    const done = async (response: Promise<JiraResponse>) => {
      const answered = await response;
      return answered.status === 200 ? { status: 204, body: null } : answered;
    };
    switch (`${method} ${part}${id ? "/id" : ""}`) {
      case "GET ": {
        const fields = query.get("fields");
        const expand = query.get("expand");
        return reshaped(
          read(t.issue, {
            issueIdOrKey,
            ...(fields ? { fields: fields.split(",") } : {}),
            ...(expand ? { expand } : {}),
            view,
          }),
          (found) => restIssue(t.issue, found),
        );
      }
      case "PUT ": {
        const fields = fieldsOf(body);
        return done(
          write(t.edit, {
            issueIdOrKey,
            fields,
            ...("description" in fields ? { contentFormat: "markdown" } : {}),
          }),
        );
      }
      case "DELETE ":
        return cannot("delete an issue");
      case "PUT assignee": {
        const account = isObject(body) ? body.accountId : null;
        return done(
          write(t.edit, {
            issueIdOrKey,
            fields: { assignee: typeof account === "string" ? { accountId: account } : null },
          }),
        );
      }
      case "GET transitions":
        return reshaped(run(o.transitions, { issueIdOrKey }), (listed) => ({
          transitions: list(o.transitions, "transitions")(listed),
        }));
      case "POST transitions": {
        const way = isObject(body) && isObject(body.transition) ? body.transition.id : undefined;
        return done(write(t.transition, { issueIdOrKey, transitionId: String(way) }));
      }
      case "GET comment": {
        const all = await comments(key);
        return all.status === 200
          ? {
              status: 200,
              body: { startAt: 0, total: (all.body as unknown[]).length, comments: all.body },
            }
          : all;
      }
      case "GET comment/id":
        return one(await comments(key), id, "comment");
      case "POST comment":
        return write(t.comment, {
          issueIdOrKey,
          commentBody: toMarkdown(adfToText(isObject(body) ? body.body : undefined)),
          contentFormat: "markdown",
        });
      case "DELETE comment/id":
        return cannot("delete a comment");
      case "GET remotelink":
        return reshaped(run(o.links, { issueIdOrKey }), list(o.links, "values"));
      case "GET remotelink/id":
        return one(
          await reshaped(run(o.links, { issueIdOrKey }), list(o.links, "values")),
          id,
          "link",
        );
      case "POST remotelink": {
        const object = isObject(body) && isObject(body.object) ? body.object : {};
        return ask(
          options.write,
          operationCall(cloudId, atlassianWriteOperations.link, {
            issueIdOrKey,
            url: object.url,
            ...(object.title === undefined ? {} : { title: object.title }),
          }),
          true,
        );
      }
      case "DELETE remotelink/id":
        return cannot("remove a link");
      default:
        return noTool(`answer ${method} ${path}`);
    }
  };
}

// The read side of it: no writer, so a write is refused before anything is
// sent, as `readOnly` refuses one too.
export const atlassianReads = (options: Omit<AtlassianOptions, "write">): ReadTransport => {
  const transport = atlassianTransport(options);
  return (request: ReadRequest) => transport(request);
};

// The site a cloud ID names, from the resources tool: the one at `site`
// when it's given, else the first with Jira. Null when there's none.
export function siteOf(
  answer: ToolAnswer,
  site: string | null,
): { cloudId: string; url: string; name: string } | null {
  const response = bodyOf(t.resources, answer);
  if (response.status !== 200)
    throw new ServerUnreadable(`${t.resources} failed: ${response.status}`);
  const listed = listOf(response.body, "resources");
  if (!listed) throw new ServerUnreadable(`${t.resources} answered with no sites`);
  const sites = listed.flatMap((each) =>
    isObject(each) &&
    typeof each.cloudId === "string" &&
    typeof each.url === "string" &&
    URL.canParse(each.url) &&
    new URL(each.url).protocol === "https:"
      ? [
          {
            cloudId: each.cloudId,
            url: new URL(each.url).origin,
            name: new URL(each.url).host,
            jira:
              Array.isArray(each.products) &&
              each.products.some((product) => isObject(product) && product.id === "jira"),
          },
        ]
      : [],
  );
  const found =
    site === null ? sites.find((each) => each.jira) : sites.find((each) => each.url === site);
  return found?.jira ? { cloudId: found.cloudId, url: found.url, name: found.name } : null;
}

// The projects the server lists, by key, in its order.
export const projectsOf = (answer: ToolAnswer): string[] =>
  projectChoicesOf(answer).map((each) => each.key);

// The same, each with its name, its key where it has none, and, where the
// server says, how many issues it holds and when one last changed.
export function projectChoicesOf(
  answer: ToolAnswer,
): { key: string; name: string; count: number | null; updatedAt: string | null }[] {
  const response = bodyOf(o.projects, answer);
  if (response.status !== 200) return [];
  const listed = listOf(response.body, "values");
  if (!listed) throw new ServerUnreadable(`${o.projects} answered with no projects`);
  return listed.flatMap((each) => {
    if (!isObject(each) || typeof each.key !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(each.key))
      return [];
    const insight = isObject(each.insight) ? each.insight : {};
    const count = insight.totalIssueCount;
    const at = insight.lastIssueUpdateTime;
    return [
      {
        key: each.key,
        name: typeof each.name === "string" ? each.name : each.key,
        count:
          typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : null,
        updatedAt: typeof at === "string" && !Number.isNaN(Date.parse(at)) ? at : null,
      },
    ];
  });
}
