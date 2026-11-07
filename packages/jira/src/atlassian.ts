// Jira through Atlassian's own MCP server (decision 0059, OA-276): the entry
// Oriel knows it by, and the parser, both ways. The parser is a transport:
// each REST request the source, its boards and the writer make becomes one
// call of the server's tools, and the tool's answer becomes the REST body
// they already check, so everything they do, revert included, works the
// same through it. A request with no tool to answer it is refused before
// anything is sent.
//
// Atlassian documents its tools' names, not their arguments or answers.
// Where it doesn't show an answer's shape, this reads the REST shape the
// tool wraps, and the paged shape its search answers with, and anything else
// it can't read stops the sync, naming the server (`ServerUnreadable`): the
// index stays as it was.
// https://support.atlassian.com/atlassian-rovo-mcp-server/docs/supported-tools/
import type { SourceServer, ToolAnswer, ToolCall, ToolCaller } from "@oriel/core";
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
  links: "listJiraIssueRemoteIssueLinks",
  boards: "listJiraBoards",
  board: "getJiraBoardConfig",
  types: "listJiraProjectIssueTypesMetadata",
  transitions: "listJiraIssueTransitions",
  me: "getJiraCurrentUser",
  projects: "listJiraProjects",
  create: "createJiraIssue",
  edit: "editJiraIssue",
  transition: "transitionJiraIssue",
  comment: "addOrEditJiraIssueComment",
  link: "createJiraIssueRemoteIssueLink",
  deleteIssue: "deleteJiraIssue",
  deleteComment: "deleteJiraComment",
} as const;

const t = atlassianTools;

// Atlassian's MCP server, as Oriel knows it. Its address is v2's, which
// lists every tool flat only with `?tools=all` (its other tools are found
// through `discover`); an address compares without its query. What it
// reports in its handshake isn't documented, so it's known by its address.
export const atlassianServer: SourceServer = {
  name: "Atlassian's Rovo MCP server",
  reports: "atlassian-rovo-mcp-server",
  at: { url: "https://mcp.atlassian.com/v2/mcp" },
  reads: [
    t.resources,
    t.search,
    t.issue,
    t.comments,
    t.links,
    t.boards,
    t.board,
    t.types,
    t.transitions,
    t.me,
    t.projects,
  ],
  writes: [t.create, t.edit, t.transition, t.comment, t.link, t.deleteIssue, t.deleteComment],
  instructions:
    "https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/",
};

// A tool's answer Oriel can't read: the sync stops, and the index stays as
// it was. Its message names the tool and what was wrong, never the answer.
export class ServerUnreadable extends Error {
  override name = "ServerUnreadable";
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// The words of a tool's text blocks, as one.
const textOf = (answer: ToolAnswer): string =>
  answer.content
    .flatMap((block) => (isObject(block) && block.type === "text" ? [String(block.text)] : []))
    .join("");

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

// A tool's answer as a REST response: its structured content, or the JSON
// of its text, or, for a failed one, the status its words mean.
export function bodyOf(tool: string, answer: ToolAnswer, write = false): JiraResponse {
  if (!isObject(answer) || !Array.isArray(answer.content))
    throw new ServerUnreadable(`${tool} answered with no content`);
  const words = textOf(answer);
  if (answer.isError === true)
    return { status: statusOf(words, write), body: { errorMessages: [words.slice(0, 300)] } };
  if (answer.structuredContent !== undefined && answer.structuredContent !== null)
    return { status: 200, body: answer.structuredContent };
  try {
    return { status: 200, body: JSON.parse(words) as unknown };
  } catch {
    throw new ServerUnreadable(`${tool} answered with text that isn't JSON`);
  }
}

// A list a tool may answer as itself or inside an object, as REST's `values`.
const listOf = (body: unknown, key: string): unknown[] | null =>
  Array.isArray(body)
    ? body
    : isObject(body) && Array.isArray(body[key])
      ? (body[key] as unknown[])
      : null;

// The search's answer as REST's: its issues, and the token for the next
// page, or none on the last. It may answer as REST does, or as a page of
// `nodes` with `pageInfo`. One that says more remain but gives no way to
// them can't be read: a sweep that stopped there would take the rest away.
export function searchBody(body: unknown): unknown {
  if (!isObject(body)) throw new ServerUnreadable(`${t.search} answered with no issues`);
  const more = () =>
    new ServerUnreadable(`${t.search} said more issues remain, with no way to them`);
  if (Array.isArray(body.issues)) {
    const given = body.nextPageToken;
    if (given !== undefined && given !== null && (typeof given !== "string" || given === ""))
      throw more();
    const token = typeof given === "string" ? given : null;
    if (token === null && body.isLast === false) throw more();
    return { issues: body.issues, nextPageToken: token, isLast: token === null };
  }
  const page = isObject(body.issues) ? body.issues : null;
  if (!page || !Array.isArray(page.nodes) || !isObject(page.pageInfo))
    throw new ServerUnreadable(`${t.search} answered with no issues`);
  const info = page.pageInfo;
  if (typeof info.hasNextPage !== "boolean")
    throw new ServerUnreadable(`${t.search} didn't say whether more issues remain`);
  const token =
    info.hasNextPage && typeof info.endCursor === "string" && info.endCursor !== ""
      ? info.endCursor
      : null;
  const remaining = typeof page.remainingCount === "number" ? page.remainingCount : 0;
  if (token === null && (info.hasNextPage || remaining > 0)) throw more();
  return { issues: page.nodes, nextPageToken: token, isLast: token === null };
}

const issuePath = /^\/rest\/api\/3\/issue\/([A-Z][A-Z0-9_]*-[0-9]+)(\/[a-z]+(?:\/[0-9]+)?)?$/;

// What a request asks, parsed: its path without the query, and the query.
const partsOf = (path: string) => {
  const url = new URL(path, "https://jira.invalid");
  return { path: url.pathname, query: url.searchParams };
};

// A REST body's `fields` as the server's edit takes them: an assignee as
// its account, everything else as REST has it.
const fieldsOf = (body: unknown): Record<string, unknown> =>
  isObject(body) && isObject(body.fields) ? body.fields : {};

// The page size Oriel asks a listing for, where REST's request names none.
const listMost = 100;

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
    return bodyOf(call.tool, await caller(call), write);
  };
  const read = (tool: string, args: Record<string, unknown>) =>
    ask(options.read, { tool, args: { cloudId, ...args } }, false);
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
        maxResults: listMost,
        orderBy: "created",
      });
      if (page.status !== 200) return page;
      const listed = list(t.comments, "comments")(page.body);
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
          ...(typeof asked.nextPageToken === "string"
            ? { nextPageToken: asked.nextPageToken }
            : {}),
        }),
        searchBody,
      );
    }
    if (method === "GET" && path === "/rest/api/3/myself") return read(t.me, {});
    if (method === "GET" && path === "/rest/agile/1.0/board")
      return reshaped(
        read(t.boards, { projectKeyOrId: query.get("projectKeyOrId") ?? "" }),
        (listed) => ({ values: list(t.boards, "values")(listed) }),
      );
    const board = /^\/rest\/agile\/1\.0\/board\/([0-9]+)\/configuration$/.exec(path);
    if (method === "GET" && board) return read(t.board, { boardId: Number(board[1]) });
    const types = /^\/rest\/api\/3\/issue\/createmeta\/([A-Z][A-Z0-9_]*)\/issuetypes$/.exec(path);
    if (method === "GET" && types)
      return reshaped(read(t.types, { projectIdOrKey: types[1] }), (listed) => {
        const issueTypes = listOf(listed, "issueTypes") ?? list(t.types, "values")(listed);
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
        issueTypeName: typeName,
        summary,
        ...(description === undefined ? {} : { description, contentFormat: "adf" }),
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
        return read(t.issue, {
          issueIdOrKey,
          ...(fields ? { fields: fields.split(",") } : {}),
          ...(expand ? { expand } : {}),
        });
      }
      case "PUT ": {
        const fields = fieldsOf(body);
        return done(
          write(t.edit, {
            issueIdOrKey,
            fields,
            ...("description" in fields ? { contentFormat: "adf" } : {}),
          }),
        );
      }
      case "DELETE ":
        return done(write(t.deleteIssue, { issueIdOrKey }));
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
        return reshaped(read(t.transitions, { issueIdOrKey }), (listed) => ({
          transitions: list(t.transitions, "transitions")(listed),
        }));
      case "POST transitions": {
        const way = isObject(body) && isObject(body.transition) ? body.transition.id : undefined;
        return done(write(t.transition, { issueIdOrKey, transition: { id: way } }));
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
          commentBody: isObject(body) ? body.body : undefined,
          contentFormat: "adf",
        });
      case "DELETE comment/id":
        return done(write(t.deleteComment, { issueIdOrKey, commentId: id }));
      case "GET remotelink":
        return reshaped(read(t.links, { issueIdOrKey }), list(t.links, "values"));
      case "GET remotelink/id":
        return one(
          await reshaped(read(t.links, { issueIdOrKey }), list(t.links, "values")),
          id,
          "link",
        );
      case "POST remotelink": {
        const object = isObject(body) && isObject(body.object) ? body.object : {};
        return write(t.link, { issueIdOrKey, url: object.url, title: object.title });
      }
      case "DELETE remotelink/id":
        return noTool("remove a link");
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
  const listed = listOf(bodyOf(t.resources, answer).body, "values");
  if (!listed) throw new ServerUnreadable(`${t.resources} answered with no sites`);
  const sites = listed.flatMap((each) =>
    isObject(each) &&
    typeof each.id === "string" &&
    typeof each.url === "string" &&
    URL.canParse(each.url) &&
    new URL(each.url).protocol === "https:"
      ? [
          {
            cloudId: each.id,
            url: new URL(each.url).origin,
            name: typeof each.name === "string" ? each.name : new URL(each.url).host,
            jira:
              !Array.isArray(each.scopes) ||
              each.scopes.some((scope) => typeof scope === "string" && scope.includes("jira")),
          },
        ]
      : [],
  );
  const found =
    site === null ? sites.find((each) => each.jira) : sites.find((each) => each.url === site);
  return found ? { cloudId: found.cloudId, url: found.url, name: found.name } : null;
}

// The projects the server lists, by key, in its order.
export function projectsOf(answer: ToolAnswer): string[] {
  const response = bodyOf(t.projects, answer);
  if (response.status !== 200) return [];
  const listed = listOf(response.body, "values");
  if (!listed) throw new ServerUnreadable(`${t.projects} answered with no projects`);
  return listed.flatMap((each) =>
    isObject(each) && typeof each.key === "string" && /^[A-Z][A-Z0-9_]*$/.test(each.key)
      ? [each.key]
      : [],
  );
}
