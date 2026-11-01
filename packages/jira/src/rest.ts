// Jira Cloud REST v3 shapes, shared by the source and the writer. Only what
// Oriel reads is validated; everything else in a response is dropped.
import {
  array,
  boolean,
  type Facets,
  type Infer,
  type Instant,
  instant,
  type ItemId,
  itemId,
  type Log,
  number,
  nullable,
  object,
  optional,
  parseItemId,
  record,
  refine,
  type State,
  string,
  unknown,
  type Validator,
} from "@oriel/core";
import { type JiraAttrs, type JiraContent, jiraFacets, jiraKind } from "./attrs.ts";
import { failure, type JiraRequest, type JiraResponse, type ReadTransport } from "./transport.ts";

export const api = "/rest/api/3";

const offset = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)(Z|[+-]\d{2}:?\d{2})$/;

// Jira's timestamps, like 2026-10-01T12:00:00.000+0100, as canonical UTC instants.
export function jiraInstant(text: string): Instant | null {
  const match = offset.exec(text);
  if (!match) return null;
  const zone = match[2] ?? "";
  const iso = `${match[1]}${zone === "Z" ? zone : `${zone.slice(0, 3)}:${zone.slice(-2)}`}`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : instant(date);
}

export const time: Validator<Instant> = (input, path = "$") => {
  const at = typeof input === "string" ? jiraInstant(input) : null;
  return at
    ? { ok: true, value: at }
    : { ok: false, issues: [{ path, message: "expected a Jira timestamp" }] };
};

export const issueKey = refine(
  string,
  (key) => parseItemId(`jira:${key}`)?.source === "jira",
  "expected an issue key",
);
export const numericId = refine(string, (id) => /^[1-9][0-9]*$/.test(id), "expected a numeric ID");

export const projectOf = (key: string) => key.slice(0, key.lastIndexOf("-"));

export const keyOf = (id: ItemId<"jira">): string => {
  const parsed = parseItemId(id);
  if (parsed?.source !== "jira") throw new RangeError(`not a Jira item ID: ${JSON.stringify(id)}`);
  return parsed.key;
};

const issueType = object({
  name: string,
  subtask: optional(boolean),
  hierarchyLevel: optional(number),
});

const user = object({ accountId: string, displayName: string });

// The fields the index keeps, as the search and issue endpoints return them.
export const indexFieldShape = {
  summary: string,
  issuetype: issueType,
  status: object({ name: string, statusCategory: object({ key: string }) }),
  parent: optional(object({ id: numericId, key: issueKey })),
  assignee: optional(nullable(user)),
  labels: optional(array(string)),
  updated: time,
};
export const indexFields = object(indexFieldShape);
export const indexFieldNames = [
  "summary",
  "issuetype",
  "status",
  "parent",
  "assignee",
  "labels",
  "updated",
];

export type IndexFields = Infer<typeof indexFields>;

export const issue = <F>(fields: Validator<F>) => object({ id: numericId, key: issueKey, fields });

// Jira's status categories are "new", "indeterminate" and "done"; a status
// outside them counts as not started.
const categories: Record<string, State> = {
  indeterminate: "in-progress",
  done: "done",
};

// Jira's hierarchy puts a standard issue's parent exactly one level up, at the
// epic level. A sub-task's parent is a standard issue and an epic's parent
// sits above epics, so neither has an epic.
const isStandard = (type: Infer<typeof issueType>) =>
  type.hierarchyLevel === undefined
    ? !type.subtask && type.name !== "Epic"
    : type.hierarchyLevel === 0;

export const epicOf = (fields: Pick<IndexFields, "issuetype" | "parent">): ItemId<"jira"> | null =>
  fields.parent && isStandard(fields.issuetype) ? itemId("jira", fields.parent.key) : null;

// The epic as a container: its handle and its stable ID.
const containerOf = (fields: Pick<IndexFields, "issuetype" | "parent">) =>
  fields.parent && isStandard(fields.issuetype)
    ? { id: itemId("jira", fields.parent.key), stableId: fields.parent.id }
    : null;

// An estimate is a number; anything else on the field isn't one.
export const pointsOf = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const rawFields = object({ fields: record(unknown) });

// A field whose ID is only known at run time, read from the raw issue.
export function rawField(raw: unknown, field: string | undefined): unknown {
  if (field === undefined) return undefined;
  const parsed = rawFields(raw);
  return parsed.ok ? parsed.value.fields[field] : undefined;
}

const categoryOf = (fields: IndexFields): State =>
  categories[fields.status.statusCategory.key] ?? "todo";

const assigneeOf = (fields: IndexFields) =>
  fields.assignee
    ? { accountId: fields.assignee.accountId, name: fields.assignee.displayName }
    : null;

export function attrsOf(fields: IndexFields): JiraAttrs {
  return {
    issueType: fields.issuetype.name,
    status: fields.status.name,
    labels: fields.labels ?? [],
  };
}

// `field` is the project's points field, undefined when its board takes no
// estimates.
export function facetsOf(fields: IndexFields, raw: unknown, field: string | undefined): Facets {
  return jiraFacets({
    category: categoryOf(fields),
    epic: containerOf(fields),
    assignee: assigneeOf(fields),
    kind: jiraKind(fields.issuetype),
    points: field === undefined ? undefined : pointsOf(rawField(raw, field)),
  });
}

// What a read returns about the fields the index also keeps. As in the
// index, there are no points when the project's board takes no estimates:
// `field`, its points field, is undefined.
export function fieldsOf(
  fields: IndexFields,
  raw: unknown,
  field: string | undefined,
): Pick<JiraContent, "issueType" | "status" | "epic" | "assignee" | "points" | "labels"> {
  return {
    issueType: fields.issuetype.name,
    status: { name: fields.status.name, category: categoryOf(fields) },
    epic: epicOf(fields),
    assignee: assigneeOf(fields),
    ...(field === undefined ? {} : { points: pointsOf(rawField(raw, field)) }),
    labels: fields.labels ?? [],
  };
}

// An issue's transitions, as `expand=transitions` returns them.
export const transitionsShape = optional(
  array(
    object({
      to: object({ name: string, statusCategory: object({ key: string }) }),
      isAvailable: optional(boolean),
    }),
  ),
);

// The statuses an issue's workflow lets it move to now, each once, in the
// order Jira lists them: not the one it is in.
export function movesOf(
  transitions: Infer<typeof transitionsShape>,
  current: string,
): JiraContent["moves"] {
  const moves = new Map<string, State>();
  for (const { to, isAvailable } of transitions ?? [])
    if (isAvailable !== false && to.name !== current && !moves.has(to.name))
      moves.set(to.name, categories[to.statusCategory.key] ?? "todo");
  return [...moves].map(([name, category]) => ({ name, category }));
}

// Sends a request, refuses anything but a 2xx, and validates the body.
export async function call<T, R extends JiraRequest>(
  transport: (request: R) => Promise<JiraResponse>,
  request: R,
  shape: Validator<T>,
): Promise<T> {
  const response = await transport(request);
  if (response.status < 200 || response.status > 299) throw failure(request, response);
  const result = shape(response.body);
  if (!result.ok) {
    const where = result.issues
      .slice(0, 3)
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join("; ");
    throw new Error(
      `${request.method} ${request.path.split("?")[0]}: unexpected response (${where})`,
    );
  }
  return result.value;
}

const boards = object({ values: array(object({ id: number, type: string })) });
const boardConfig = object({
  estimation: optional(
    object({ type: string, field: optional(object({ fieldId: string, displayName: string })) }),
  ),
});

// Each project's estimate field, from its board's estimation config: a Scrum
// board's if it has one, else its first board's. The field ID differs per
// site and per project style, so it is never hardcoded. A project whose board
// counts issues or estimates in time has no points field; time fields are
// system fields, not custom ones.
export async function discoverPoints(
  transport: ReadTransport,
  projects: readonly string[],
  log: Log,
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (const project of projects) {
    const listed = await call(
      transport,
      { method: "GET", path: `/rest/agile/1.0/board?projectKeyOrId=${project}` },
      boards,
    );
    const board = listed.values.find((b) => b.type === "scrum") ?? listed.values[0];
    if (!board) {
      log("jira: no board, so no estimate field", { project });
      continue;
    }
    const config = await call(
      transport,
      { method: "GET", path: `/rest/agile/1.0/board/${board.id}/configuration` },
      boardConfig,
    );
    const field =
      config.estimation?.type === "field" ? config.estimation.field?.fieldId : undefined;
    if (!field || !/^customfield_[0-9]+$/.test(field)) {
      log("jira: the board doesn't estimate in a points field", { project, board: board.id });
      continue;
    }
    found.set(project, field);
  }
  return found;
}

export const projectKey = /^[A-Z][A-Z0-9_]*$/;
