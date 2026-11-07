// Linear through Linear's own MCP server (decision 0059, OA-278): the entry
// Oriel knows it by, and the parser, both ways. Linear is reached only
// through its server: Oriel has no API key or token connection of its own
// to it.
//
// Linear documents its server's address and how to add it to an agent
// (https://linear.app/docs/mcp), not its tools. Their names and arguments
// are from the server's own tool list as published third-party listings
// show it; their answers aren't shown anywhere. Where an answer's shape
// isn't known, this reads the likely ones, a list bare or under its name,
// a status as a name or an object, and anything else it can't read stops
// the sync, naming the server (`ServerUnreadable`): the index stays as it
// was. packages/standin-mcp/README.md lists what's assumed.
import {
  answerText,
  ServerUnreadable,
  SourceRefused,
  type SourceServer,
  type ToolAnswer,
  type ToolCaller,
  WriteStalled,
} from "@oriel/core";
import { type StatusType, statusTypes } from "./world.ts";

// Its tools Oriel calls, by what each does.
export const linearTools = {
  teams: "list_teams",
  statuses: "list_issue_statuses",
  cycles: "list_cycles",
  users: "list_users",
  projects: "list_projects",
  project: "get_project",
  issues: "list_issues",
  issue: "get_issue",
  saveIssue: "save_issue",
  saveProject: "save_project",
} as const;

const t = linearTools;

// Linear's MCP server, as Oriel knows it: by its address, as what it reports
// in its handshake isn't documented. Its read-only address,
// `/mcp/readonly`, has no write tools, so it isn't this one. No tool
// deletes an issue or a project, so a create can't be undone through it
// (`unsendable` in writer.ts).
export const linearServer: SourceServer = {
  name: "Linear's MCP server",
  reports: "linear",
  at: { url: "https://mcp.linear.app/mcp" },
  reads: [t.teams, t.statuses, t.cycles, t.users, t.projects, t.project, t.issues, t.issue],
  writes: [t.saveIssue, t.saveProject],
  instructions: "https://linear.app/docs/mcp",
};

export type LinearTeam = { id: string; key: string; name: string };
export type LinearStatus = { id: string; name: string; type: StatusType };
export type LinearCycle = {
  id: string;
  number: number;
  name: string | null;
  startsAt: string;
  endsAt: string;
};
export type LinearPerson = { id: string; name: string; active: boolean };
export type LinearProject = {
  id: string;
  // The 12 hex digits its URL ends in, which Oriel keys it by.
  slugId: string;
  name: string;
  description: string;
  status: { name: string; type: string };
  lead: string | null;
  targetDate: string | null;
  url: string;
  updatedAt: string;
};
export type LinearIssue = {
  id: string;
  identifier: string;
  title: string;
  description: string;
  // Its status by name, and its type where the answer gives one.
  status: string;
  statusType: StatusType | null;
  assignee: { id: string; name: string } | null;
  // Its project's and its cycle's UUIDs, and its parent's, each or null.
  project: string | null;
  cycle: string | null;
  parent: string | null;
  estimate: number | null;
  labels: string[];
  url: string;
  updatedAt: string;
};

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// A tool's answer as JSON: its structured content, or its text parsed. A
// failed one is `failed` with its words, which only say whether it was a
// refusal and are never passed on.
function bodyOf(tool: string, answer: ToolAnswer): { failed: string } | { body: unknown } {
  if (!isObject(answer) || !Array.isArray(answer.content))
    throw new ServerUnreadable(`${tool} answered with no content`);
  if (answer.isError === true) return { failed: answerText(answer) };
  if (answer.structuredContent !== undefined && answer.structuredContent !== null)
    return { body: answer.structuredContent };
  try {
    return { body: JSON.parse(answerText(answer)) as unknown };
  } catch {
    throw new ServerUnreadable(`${tool} answered with text that isn't JSON`);
  }
}

const notFound = (words: string) =>
  /\b(not found|does not exist|no such|could not find)\b/i.test(words);
// Words that say the server turned a write away unmade, such as an argument
// it doesn't take. A write that failed for a reason it doesn't give may
// have landed.
const turnedAway = (words: string) =>
  notFound(words) ||
  /\b(invalid|validation|required|not allowed|forbidden|permission|unauthori[sz]ed|unknown|must be)\b/i.test(
    words,
  );

// A list a tool may answer as itself or under its name, or as `nodes`.
function listOf(tool: string, body: unknown, key: string): unknown[] {
  if (Array.isArray(body)) return body;
  if (isObject(body)) {
    const found = Array.isArray(body[key]) ? body[key] : body.nodes;
    if (Array.isArray(found)) return found;
  }
  throw new ServerUnreadable(`${tool} answered with no ${key}`);
}

// The cursor a page gives for the next: `pageInfo`'s, or one beside the
// list. `null` when it says there's no more; `undefined` when it doesn't
// say.
function nextOf(tool: string, body: unknown): string | null | undefined {
  if (!isObject(body)) return undefined;
  const info = isObject(body.pageInfo) ? body.pageInfo : body;
  const more = info.hasNextPage;
  const cursor = [info.endCursor, info.nextCursor, info.cursor].find(
    (each) => typeof each === "string" && each !== "",
  ) as string | undefined;
  if (more === false) return null;
  if (more === true && cursor === undefined)
    throw new ServerUnreadable(`${tool} said more remain, with no way to them`);
  return cursor;
}

// How many a listing asks for at a time; Linear's limit is 250.
export const pageSize = 250;
// A sweep that goes on longer than this is a server that keeps answering
// the same page.
const mostPages = 200;

// Every item a listing tool gives, page by page. A page that says more
// remain gives the cursor to them; one that doesn't say is followed by the
// page after its last item (`after`, "an ID to start from"), while it was
// full. A cursor given twice can't be read.
async function listAll(
  read: ToolCaller,
  tool: string,
  args: Json,
  key: string,
): Promise<unknown[]> {
  const all: unknown[] = [];
  const seen = new Set<string>();
  let after: string | null = null;
  for (let page = 0; page < mostPages; page += 1) {
    const answer = bodyOf(
      tool,
      await read({ tool, args: { ...args, limit: pageSize, ...(after ? { after } : {}) } }),
    );
    if ("failed" in answer) throw new ServerUnreadable(`${tool} answered with an error`);
    const listed = listOf(tool, answer.body, key);
    all.push(...listed);
    const given = nextOf(tool, answer.body);
    const last = listed.at(-1);
    const next =
      given === undefined
        ? listed.length >= pageSize && isObject(last) && typeof last.id === "string"
          ? last.id
          : null
        : given;
    if (next === null) return all;
    if (seen.has(next)) throw new ServerUnreadable(`${tool} gave the same page twice`);
    seen.add(next);
    after = next;
  }
  throw new ServerUnreadable(`${tool} kept giving more pages`);
}

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
// A field that is an object with an ID, or its ID beside it as `<field>Id`.
const idOf = (item: Json, field: string): string | null =>
  isObject(item[field]) && typeof (item[field] as Json).id === "string"
    ? ((item[field] as Json).id as string)
    : text(item[`${field}Id`]);
const isStatusType = (value: unknown): value is StatusType =>
  statusTypes.includes(value as StatusType);
// A number, or `{ value }` as an estimate or a priority may come.
const numberOf = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value)
    ? value
    : isObject(value) && typeof value.value === "number" && Number.isFinite(value.value)
      ? value.value
      : null;

// A slug ID: the answer's own, or the 12 hex digits its URL ends in.
function slugOf(project: Json): string | null {
  const own = text(project.slugId);
  if (own && /^[0-9a-f]{12}$/.test(own)) return own;
  return /-([0-9a-f]{12})(?:\/|$)/.exec(text(project.url) ?? "")?.[1] ?? null;
}

export function readTeam(value: unknown): LinearTeam {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    typeof value.key !== "string" ||
    typeof value.name !== "string"
  )
    throw new ServerUnreadable(`${t.teams} gave a team Oriel can't read`);
  return { id: value.id, key: value.key, name: value.name };
}

export function readStatus(value: unknown): LinearStatus {
  if (!isObject(value) || typeof value.id !== "string" || typeof value.name !== "string")
    throw new ServerUnreadable(`${t.statuses} gave a status Oriel can't read`);
  if (!isStatusType(value.type))
    throw new ServerUnreadable(`${t.statuses} gave a status of a type Oriel doesn't know`);
  return { id: value.id, name: value.name, type: value.type };
}

export function readCycle(value: unknown): LinearCycle {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    typeof value.number !== "number" ||
    typeof value.startsAt !== "string" ||
    typeof value.endsAt !== "string"
  )
    throw new ServerUnreadable(`${t.cycles} gave a cycle Oriel can't read`);
  return {
    id: value.id,
    number: value.number,
    name: text(value.name),
    startsAt: value.startsAt.slice(0, 10),
    endsAt: value.endsAt.slice(0, 10),
  };
}

export function readPerson(value: unknown): LinearPerson {
  const name = isObject(value) ? (text(value.name) ?? text(value.displayName)) : null;
  if (!isObject(value) || typeof value.id !== "string" || name === null)
    throw new ServerUnreadable(`${t.users} gave a person Oriel can't read`);
  const active = value.active ?? value.isActive;
  return { id: value.id, name, active: active !== false };
}

export function readProject(value: unknown, tool: string = t.projects): LinearProject {
  const unreadable = () => new ServerUnreadable(`${tool} gave a project Oriel can't read`);
  if (!isObject(value) || typeof value.id !== "string" || typeof value.name !== "string")
    throw unreadable();
  const slugId = slugOf(value);
  const updatedAt = text(value.updatedAt);
  if (slugId === null || updatedAt === null || !Number.isFinite(Date.parse(updatedAt)))
    throw unreadable();
  const status = isObject(value.status)
    ? { name: text(value.status.name) ?? "", type: text(value.status.type) ?? "" }
    : { name: text(value.status) ?? text(value.state) ?? "", type: text(value.state) ?? "" };
  const lead = isObject(value.lead) ? text(value.lead.name) : text(value.lead);
  return {
    id: value.id,
    slugId,
    name: value.name,
    description: text(value.description) ?? text(value.summary) ?? "",
    status,
    lead,
    targetDate: text(value.targetDate),
    url: text(value.url) ?? "",
    updatedAt: new Date(updatedAt).toISOString(),
  };
}

export function readIssue(value: unknown, tool: string = t.issues): LinearIssue {
  const unreadable = () => new ServerUnreadable(`${tool} gave an issue Oriel can't read`);
  if (!isObject(value)) throw unreadable();
  const { id, identifier, title } = value;
  const updatedAt = text(value.updatedAt);
  if (
    typeof id !== "string" ||
    typeof identifier !== "string" ||
    typeof title !== "string" ||
    updatedAt === null ||
    !Number.isFinite(Date.parse(updatedAt))
  )
    throw unreadable();
  // Its status as a name, or as an object with its type, as `status` or
  // `state`.
  const state = value.status ?? value.state;
  const status = isObject(state) ? text(state.name) : text(state);
  if (status === null) throw unreadable();
  const type = isObject(state) ? state.type : value.statusType;
  const assigneeId = idOf(value, "assignee");
  const assigneeName = isObject(value.assignee)
    ? (text(value.assignee.name) ?? text(value.assignee.displayName))
    : text(value.assignee);
  const labels = Array.isArray(value.labels)
    ? value.labels.flatMap((each) =>
        typeof each === "string"
          ? [each]
          : isObject(each) && text(each.name)
            ? [text(each.name) ?? ""]
            : [],
      )
    : [];
  return {
    id,
    identifier,
    title,
    description: text(value.description) ?? "",
    status,
    statusType: isStatusType(type) ? type : null,
    assignee: assigneeId && assigneeName ? { id: assigneeId, name: assigneeName } : null,
    project: idOf(value, "project"),
    cycle: idOf(value, "cycle"),
    parent: idOf(value, "parent"),
    estimate: numberOf(value.estimate),
    labels,
    url: text(value.url) ?? "",
    updatedAt: new Date(updatedAt).toISOString(),
  };
}

// The server's reads, parsed, from the process with only its read tools.
export function linearReads(read: ToolCaller) {
  const one = async <T>(tool: string, args: Json, parse: (value: unknown) => T) => {
    const answer = bodyOf(tool, await read({ tool, args }));
    if ("failed" in answer) {
      if (notFound(answer.failed)) return null;
      throw new ServerUnreadable(`${tool} answered with an error`);
    }
    // One item, bare or under its name.
    const body = answer.body;
    return parse(
      isObject(body) && isObject(body.issue)
        ? body.issue
        : isObject(body) && isObject(body.project)
          ? body.project
          : body,
    );
  };
  return {
    teams: async () => (await listAll(read, t.teams, {}, "teams")).map(readTeam),
    statuses: async (team: string) => {
      const answer = bodyOf(t.statuses, await read({ tool: t.statuses, args: { team } }));
      if ("failed" in answer) throw new ServerUnreadable(`${t.statuses} answered with an error`);
      return listOf(t.statuses, answer.body, "statuses").map(readStatus);
    },
    cycles: async (teamId: string) => {
      const answer = bodyOf(t.cycles, await read({ tool: t.cycles, args: { teamId } }));
      if ("failed" in answer) throw new ServerUnreadable(`${t.cycles} answered with an error`);
      return listOf(t.cycles, answer.body, "cycles").map(readCycle);
    },
    users: async (query: string) => {
      const answer = bodyOf(t.users, await read({ tool: t.users, args: { query } }));
      if ("failed" in answer) throw new ServerUnreadable(`${t.users} answered with an error`);
      return listOf(t.users, answer.body, "users").map(readPerson);
    },
    projects: async (teamId: string) =>
      (await listAll(read, t.projects, { teamId }, "projects")).map((each) => readProject(each)),
    issues: async (team: string) =>
      (await listAll(read, t.issues, { team, orderBy: "createdAt" }, "issues")).map((each) =>
        readIssue(each),
      ),
    issue: (id: string) => one(t.issue, { id }, (value) => readIssue(value, t.issue)),
    project: (query: string) => one(t.project, { query }, (value) => readProject(value, t.project)),
  };
}

export type LinearReads = ReturnType<typeof linearReads>;

// The server's writes, from the process with only its write tools: what
// each saved, as the server answers it. An answer that says it turned the
// write away is a refusal, with nothing made; any other failure may have
// landed.
export function linearWrites(write: ToolCaller) {
  const save = async <T>(tool: string, args: Json, parse: (value: unknown) => T): Promise<T> => {
    const answer = bodyOf(
      tool,
      await write({ tool, args }).catch((error: unknown) => {
        // Never sent, or turned away unprocessed: none of it landed.
        if (error instanceof WriteStalled)
          throw new SourceRefused(error.message, { sent: false, cause: error });
        throw error;
      }),
    );
    if ("failed" in answer) {
      const why = `${linearServer.name} refused it`;
      if (turnedAway(answer.failed)) throw new SourceRefused(why, { sent: true });
      throw new Error(`${tool} failed, and may have saved`);
    }
    const body = answer.body;
    return parse(
      isObject(body) && isObject(body.issue)
        ? body.issue
        : isObject(body) && isObject(body.project)
          ? body.project
          : body,
    );
  };
  return {
    issue: (args: Json) => save(t.saveIssue, args, (value) => readIssue(value, t.saveIssue)),
    project: (args: Json) =>
      save(t.saveProject, args, (value) => readProject(value, t.saveProject)),
  };
}
