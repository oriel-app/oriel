// Recreates SYN on the throwaway site from fixtures/jira, which stay the
// source of truth. Issues are created in key order so live keys match fixture
// keys; a key the fixtures skip gets a placeholder that is created, then
// deleted. The fixture's source edits are applied last. Field IDs are discovered
// at run time. It refuses unless SYN exists, is company-managed and holds no
// issues, and it deletes only what this run created.
// Usage: pnpm seed:jira [--dry-run | --preflight]
import { existsSync, readFileSync } from "node:fs";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import type { FixtureIssue, JiraFixture } from "../packages/core/src/fixture.ts";
import {
  array,
  boolean,
  number,
  object,
  optional,
  record,
  string,
  unknown,
  type Validator,
} from "../packages/core/src/validate.ts";
import { loadJiraFixture } from "./fixtures/load.ts";

// The only site this script writes to (SPEC §4).
const throwawaySite = "https://oriel.atlassian.net";

export type JiraEnv = { site: string; email: string; token: string };

// Reads JIRA_SITE, JIRA_EMAIL and JIRA_API_TOKEN and nothing else. Messages
// never include a value.
export function jiraEnv(envFile: string | null): JiraEnv | { error: string } {
  const env = envFile ? parseEnv(envFile) : {};
  const site = env.JIRA_SITE;
  const email = env.JIRA_EMAIL;
  const token = env.JIRA_API_TOKEN;
  if (!site || !email || !token)
    return { error: "JIRA_SITE, JIRA_EMAIL and JIRA_API_TOKEN must all be set in .env" };
  if (!URL.canParse(site) || new URL(site).origin !== throwawaySite)
    return { error: `JIRA_SITE must be the throwaway site, ${throwawaySite}` };
  return { site: throwawaySite, email, token };
}

export type Step =
  | { kind: "create"; key: string; issue: FixtureIssue }
  | { kind: "placeholder"; key: string }
  | { kind: "comment"; key: string; body: string }
  | { kind: "link"; key: string; url: string; title: string }
  | { kind: "status"; key: string; status: string }
  | { kind: "edit"; key: string; fields: { summary: string } | { parent: string } }
  | { kind: "delete"; key: string };

const keyNumber = (key: string) => Number(key.slice(key.lastIndexOf("-") + 1));

// Pure: what the seed will do, in order. Only what is in the fixtures is
// seeded (SPEC §5).
export function plan(fixture: JiraFixture): Step[] {
  const byNumber = new Map(fixture.issues.map((issue) => [keyNumber(issue.key), issue]));
  const last = Math.max(0, ...byNumber.keys());
  const steps: Step[] = [];
  for (let n = 1; n <= last; n++) {
    const key = `${fixture.project.key}-${n}`;
    const issue = byNumber.get(n);
    if (!issue) {
      steps.push({ kind: "placeholder", key }, { kind: "delete", key });
      continue;
    }
    steps.push({ kind: "create", key, issue });
    for (const comment of issue.comments) steps.push({ kind: "comment", key, body: comment.body });
    for (const link of issue.links)
      steps.push({ kind: "link", key, url: link.url, title: link.title });
    steps.push({ kind: "status", key, status: issue.status.name });
  }
  for (const edit of fixture.edits) {
    if (edit.kind === "setEpic")
      steps.push({ kind: "edit", key: edit.key, fields: { parent: edit.epic } });
    if (edit.kind === "setSummary")
      steps.push({ kind: "edit", key: edit.key, fields: { summary: edit.summary } });
    if (edit.kind === "delete") steps.push({ kind: "delete", key: edit.key });
  }
  return steps;
}

// Plain text as Atlassian Document Format: blank lines split paragraphs and
// single newlines become hard breaks. Text nodes are literal, so nothing in
// the fixture is read as markup.
export function adf(text: string) {
  return {
    type: "doc",
    version: 1,
    content: text.split(/\n{2,}/).map((paragraph) => ({
      type: "paragraph",
      content: paragraph
        .split("\n")
        .flatMap((line, i) => [
          ...(i > 0 ? [{ type: "hardBreak" }] : []),
          ...(line ? [{ type: "text", text: line }] : []),
        ]),
    })),
  };
}

// What discovery found. In a dry run each value is a <placeholder>.
export type Discovered = { pointsField: string; issueTypes: Record<string, string> };

export type Request = { method: "GET" | "POST" | "PUT" | "DELETE"; path: string; body?: unknown };

const api = "/rest/api/3";

function typeId(found: Discovered, name: string): string {
  const id = found.issueTypes[name];
  if (!id) throw new Error(`no issue type ${name} in the project`);
  return id;
}

// The request for one step. A status step's transition ID is read from the
// issue at run time, so `transition` names it until then.
export function request(
  project: string,
  step: Step,
  found: Discovered,
  transition?: string,
): Request {
  const issue = `${api}/issue/${step.key}`;
  switch (step.kind) {
    case "create": {
      const { issue: fixture } = step;
      // Always unassigned: the site has one real user, so the fixture's
      // people can't be assigned. Assignees stay in the fixtures only; besides
      // them, the live copy differs only where Jira sets values itself
      // (comment authors and times, updatedAt, link IDs).
      const fields: Record<string, unknown> = {
        project: { key: project },
        issuetype: { id: typeId(found, fixture.issueType) },
        summary: fixture.summary,
        labels: fixture.labels,
        assignee: null,
      };
      if (fixture.description) fields.description = adf(fixture.description);
      if (fixture.epic !== null) fields.parent = { key: fixture.epic };
      if (fixture.points !== null) fields[found.pointsField] = fixture.points;
      return { method: "POST", path: `${api}/issue`, body: { fields } };
    }
    case "placeholder":
      return {
        method: "POST",
        path: `${api}/issue`,
        body: {
          fields: {
            project: { key: project },
            issuetype: { id: typeId(found, "Task") },
            summary: `Placeholder for ${step.key}, deleted by the seed so later keys match the fixtures`,
          },
        },
      };
    case "comment":
      return { method: "POST", path: `${issue}/comment`, body: { body: adf(step.body) } };
    case "link":
      return {
        method: "POST",
        path: `${issue}/remotelink`,
        body: { object: { url: step.url, title: step.title } },
      };
    case "status":
      return {
        method: "POST",
        path: `${issue}/transitions`,
        body: { transition: { id: transition ?? `<to ${step.status}>` } },
      };
    case "edit": {
      const fields =
        "parent" in step.fields ? { parent: { key: step.fields.parent } } : step.fields;
      return { method: "PUT", path: issue, body: { fields } };
    }
    case "delete":
      return { method: "DELETE", path: issue };
  }
}

// One line per request. Rich text and long strings are shortened.
export function describe(request: Request): string {
  if (request.body === undefined) return `${request.method} ${request.path}`;
  const body = JSON.stringify(request.body, (key, value: unknown) => {
    if ((key === "description" || key === "body") && isDoc(value))
      return `<rich text, ${textLength(value)} chars>`;
    if (typeof value === "string" && value.length > 80) return `${value.slice(0, 77)}...`;
    return value;
  });
  return `${request.method} ${request.path} ${body}`;
}

function isDoc(value: unknown): boolean {
  return typeof value === "object" && value !== null && "type" in value && value.type === "doc";
}

function textLength(node: unknown): number {
  if (typeof node !== "object" || node === null) return 0;
  const text = "text" in node && typeof node.text === "string" ? node.text.length : 0;
  const content: unknown[] = "content" in node && Array.isArray(node.content) ? node.content : [];
  return content.reduce((sum: number, child) => sum + textLength(child), text);
}

const typesUsed = (fixture: JiraFixture) => [
  ...new Set([...fixture.issues.map((issue) => issue.issueType), "Task"]),
];

export function dryRun(fixture: JiraFixture): string[] {
  const project = fixture.project.key;
  const found: Discovered = {
    pointsField: "<Story Points field>",
    issueTypes: Object.fromEntries(typesUsed(fixture).map((name) => [name, `<${name} type>`])),
  };
  const steps = plan(fixture).map((step) => {
    const line = describe(request(project, step, found));
    if (step.kind === "create" || step.kind === "placeholder") return `${line} -> ${step.key}`;
    if (step.kind === "status") return `${line}, unless already ${step.status}`;
    return line;
  });
  return [
    "Dry run: nothing is sent and .env is not read. <...> is found at run time.",
    `GET ${api}/project/${project}: refuse unless it exists and is company-managed`,
    `GET ${permissionsPath(project)}: refuse unless every one is held`,
    `GET ${api}/configuration: refuse unless issue linking is on and unassigned issues are allowed`,
    `POST ${api}/search/jql {"jql":"project = ${project}","maxResults":1,"fields":["id"]}: refuse unless it has no issues`,
    `GET ${api}/project/${project}/statuses: refuse unless every fixture status exists`,
    `GET /rest/agile/1.0/board?projectKeyOrId=${project}&type=scrum: the board`,
    "GET /rest/agile/1.0/board/<board>/configuration: its estimation field must be Story Points",
    `GET ${api}/issue/createmeta/${project}/issuetypes: issue type IDs`,
    `GET ${api}/issue/createmeta/${project}/issuetypes/<type>?maxResults=200: per type, refuse unless the create screen has every field sent`,
    ...steps,
  ];
}

// Live run.

type Response = { status: number; body: unknown };
type Call = (request: Request) => Promise<Response>;

function client(env: JiraEnv): Call {
  const auth = `Basic ${Buffer.from(`${env.email}:${env.token}`).toString("base64")}`;
  return async (request) => {
    for (let attempt = 1; ; attempt++) {
      const response = await fetch(`${env.site}${request.path}`, {
        method: request.method,
        headers: {
          Authorization: auth,
          Accept: "application/json",
          ...(request.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      });
      if ((response.status === 429 || response.status === 503) && attempt < 5) {
        const seconds = Number(response.headers.get("Retry-After")) || 5;
        await wait(Math.min(seconds, 60) * 1000);
        continue;
      }
      const text = await response.text();
      return { status: response.status, body: parseJson(text) };
    }
  };
}

function parseJson(text: string): unknown {
  try {
    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    return text.slice(0, 300);
  }
}

function accept<T>(request: Request, response: Response, shape: Validator<T>): T {
  const { status, body } = response;
  if (status < 200 || status > 299)
    throw new Error(`${describe(request)}: ${status} ${JSON.stringify(body).slice(0, 300)}`);
  const result = shape(body);
  if (!result.ok) throw new Error(`${request.method} ${request.path}: unexpected response`);
  return result.value;
}

async function send<T>(call: Call, request: Request, shape: Validator<T>): Promise<T> {
  return accept(request, await call(request), shape);
}

const get = (path: string): Request => ({ method: "GET", path });

// Project permissions the run needs. Remote links need Browse projects and
// Link issues; creating an issue unassigned needs Assign issues.
const permissions = [
  "BROWSE_PROJECTS",
  "CREATE_ISSUES",
  "EDIT_ISSUES",
  "DELETE_ISSUES",
  "TRANSITION_ISSUES",
  "ADD_COMMENTS",
  "LINK_ISSUES",
  "ASSIGN_ISSUES",
];
const permissionsPath = (project: string) =>
  `${api}/mypermissions?projectKey=${project}&permissions=${permissions.join(",")}`;

const projectShape = object({ key: string, style: string });
const permissionsShape = object({ permissions: record(object({ havePermission: boolean })) });
const configurationShape = object({
  issueLinkingEnabled: boolean,
  unassignedIssuesAllowed: boolean,
});
const searchShape = object({ issues: array(unknown) });
const statusesShape = array(object({ name: string, statuses: array(object({ name: string })) }));
const boardsShape = object({ values: array(object({ id: number })) });
const boardConfigShape = object({
  estimation: optional(
    object({ field: optional(object({ fieldId: string, displayName: string })) }),
  ),
});
const issueTypesShape = object({ issueTypes: array(object({ id: string, name: string })) });
const createFieldsShape = object({
  fields: array(
    object({
      fieldId: string,
      name: string,
      required: boolean,
      hasDefaultValue: optional(boolean),
    }),
  ),
});
const createdShape = object({ id: string, key: string });
const issueStatusShape = object({ fields: object({ status: object({ name: string }) }) });
const transitionsShape = object({
  transitions: array(object({ id: string, to: object({ name: string }) })),
});

async function discover(fixture: JiraFixture, call: Call): Promise<Discovered> {
  const project = fixture.project.key;
  const projectRequest = get(`${api}/project/${project}`);
  const found = await call(projectRequest);
  if (found.status === 404) throw new Error(`refusing: project ${project} doesn't exist`);
  const info = accept(projectRequest, found, projectShape);
  if (info.style !== "classic") throw new Error(`refusing: ${project} isn't company-managed`);

  const held = await send(call, get(permissionsPath(project)), permissionsShape);
  const missing = permissions.filter((key) => !held.permissions[key]?.havePermission);
  if (missing.length) throw new Error(`refusing: missing permissions ${missing.join(", ")}`);

  const settings = await send(call, get(`${api}/configuration`), configurationShape);
  if (!settings.unassignedIssuesAllowed)
    throw new Error("refusing: the site doesn't allow unassigned issues");
  if (!settings.issueLinkingEnabled && fixture.issues.some((issue) => issue.links.length))
    throw new Error("refusing: issue linking is off, so remote links can't be added");

  const search = await send(
    call,
    {
      method: "POST",
      path: `${api}/search/jql`,
      body: { jql: `project = ${project}`, maxResults: 1, fields: ["id"] },
    },
    searchShape,
  );
  if (search.issues.length > 0) throw new Error(`refusing: ${project} already has issues`);

  const statuses = await send(call, get(`${api}/project/${project}/statuses`), statusesShape);
  for (const issue of fixture.issues) {
    const type = statuses.find((entry) => entry.name === issue.issueType);
    if (!type?.statuses.some((status) => status.name === issue.status.name))
      throw new Error(`refusing: no status ${issue.status.name} for ${issue.issueType}`);
  }

  const boards = await send(
    call,
    get(`/rest/agile/1.0/board?projectKeyOrId=${project}&type=scrum`),
    boardsShape,
  );
  const board = boards.values[0];
  if (!board) throw new Error(`refusing: ${project} has no Scrum board`);
  const config = await send(
    call,
    get(`/rest/agile/1.0/board/${board.id}/configuration`),
    boardConfigShape,
  );
  const estimation = config.estimation?.field;
  if (!estimation || estimation.displayName.toLowerCase() !== "story points")
    throw new Error("refusing: the board doesn't estimate in Story Points");

  const types = await send(
    call,
    get(`${api}/issue/createmeta/${project}/issuetypes`),
    issueTypesShape,
  );
  const issueTypes: Record<string, string> = {};
  // Transitions and edit screens can't be checked before issues exist.
  for (const name of typesUsed(fixture)) {
    const type = types.issueTypes.find((entry) => entry.name === name);
    if (!type) throw new Error(`refusing: no issue type ${name} in ${project}`);
    issueTypes[name] = type.id;
    const screen = await send(
      call,
      get(`${api}/issue/createmeta/${project}/issuetypes/${type.id}?maxResults=200`),
      createFieldsShape,
    );
    const ids = new Set(screen.fields.map((field) => field.fieldId));
    // Creates always send labels and assignee, and description when there is one.
    for (const field of ["labels", "description", "assignee"])
      if (!ids.has(field)) throw new Error(`refusing: ${field} isn't on the ${name} create screen`);
    const ofType = fixture.issues.filter((issue) => issue.issueType === name);
    if (ofType.some((issue) => issue.points !== null) && !ids.has(estimation.fieldId))
      throw new Error(`refusing: Story Points isn't on the ${name} create screen`);
    if (ofType.some((issue) => issue.epic !== null) && !ids.has("parent"))
      throw new Error(`refusing: parent isn't on the ${name} create screen`);
    const unset = screen.fields.filter(
      (field) =>
        field.required &&
        !field.hasDefaultValue &&
        !["project", "issuetype", "summary"].includes(field.fieldId),
    );
    if (unset.length)
      throw new Error(
        `refusing: ${name} requires fields the fixtures don't have: ${unset.map((field) => field.name).join(", ")}`,
      );
  }
  return { pointsField: estimation.fieldId, issueTypes };
}

async function seed(fixture: JiraFixture, call: Call): Promise<void> {
  const project = fixture.project.key;
  const found = await discover(fixture, call);
  const created = new Set<string>();
  for (const step of plan(fixture)) {
    if (step.kind === "status") {
      const issue = `${api}/issue/${step.key}`;
      const current = await send(call, get(`${issue}?fields=status`), issueStatusShape);
      if (current.fields.status.name === step.status) continue;
      const { transitions } = await send(call, get(`${issue}/transitions`), transitionsShape);
      const transition = transitions.find((t) => t.to.name === step.status);
      if (!transition) throw new Error(`no transition to ${step.status} from ${step.key}`);
      const move = request(project, step, found, transition.id);
      console.log(describe(move));
      await send(call, move, unknown);
      continue;
    }
    if (step.kind === "delete" && !created.has(step.key))
      throw new Error(`refusing to delete ${step.key}: this run didn't create it`);
    const next = request(project, step, found);
    console.log(describe(next));
    if (step.kind !== "create" && step.kind !== "placeholder") {
      await send(call, next, unknown);
      continue;
    }
    const issue = await send(call, next, createdShape);
    if (issue.key !== step.key)
      throw new Error(
        `created ${issue.key}, expected ${step.key}: ${project}'s key counter isn't fresh. Recreate the project and run again.`,
      );
    created.add(issue.key);
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some((arg) => arg !== "--dry-run" && arg !== "--preflight")) {
    console.error("usage: pnpm seed:jira [--dry-run | --preflight]");
    process.exit(1);
  }
  const fixture = loadJiraFixture();
  if (args.includes("--dry-run")) {
    for (const line of dryRun(fixture)) console.log(line);
    process.exit(0);
  }
  const envPath = fileURLToPath(new URL("../.env", import.meta.url));
  const env = jiraEnv(existsSync(envPath) ? readFileSync(envPath, "utf8") : null);
  if ("error" in env) {
    console.error(env.error);
    process.exit(1);
  }
  try {
    // --preflight runs only the read-only checks against the live site and
    // writes nothing, so a run can be validated before it creates anything.
    if (args.includes("--preflight")) {
      const found = await discover(fixture, client(env));
      console.log(
        `preflight ok: estimation field ${found.pointsField}, issue types ${Object.keys(found.issueTypes).join(", ")}`,
      );
    } else {
      await seed(fixture, client(env));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
