import {
  array,
  type IndexRecord,
  type Instant,
  isInstant,
  issueAttrs,
  type IssueAttrs,
  issueColumns,
  issueDetails,
  type IssueFields,
  type ItemId,
  literal,
  nullable,
  number,
  object,
  optional,
  parseItemId,
  type Presentation,
  refine,
  type State,
  string,
  union,
  unknown,
  type Validator,
} from "@oriel/core";

export type JiraAttrs = IssueAttrs;

export type JiraRecord = IndexRecord<"jira", JiraAttrs>;

export type JiraContent = {
  issueType: string;
  status: { name: string; category: State };
  moves: { name: string; category: State }[];
  epic: ItemId<"jira"> | null;
  assignee: { accountId: string; name: string } | null;
  // Null when not estimated yet; absent when its board takes no estimates.
  points?: number | null;
  labels: string[];
  summary: string;
  description: string;
  descriptionDoc?: unknown;
  comments: { author: string; body: string; bodyDoc?: unknown; at: Instant }[];
  links: { linkId: string; url: string; title: string }[];
  title: string;
  text: string;
};

export const jiraAttrs: Validator<JiraAttrs> = issueAttrs;

const jiraId = refine(string, isJiraId, "expected a Jira item ID");
const state = union(literal("todo"), literal("in-progress"), literal("done"));

// What a read returns, checked where it is used: a reader may sit behind any
// transport.
export const jiraContent = object({
  issueType: string,
  status: object({ name: string, category: state }),
  moves: array(object({ name: string, category: state })),
  epic: nullable(jiraId),
  assignee: nullable(object({ accountId: string, name: string })),
  points: optional(nullable(number)),
  labels: array(string),
  summary: string,
  description: string,
  descriptionDoc: optional(unknown),
  comments: array(
    object({
      author: string,
      body: string,
      bodyDoc: optional(unknown),
      at: refine(string, isInstant, "expected an instant"),
    }),
  ),
  links: array(object({ linkId: string, url: string, title: string })),
  title: string,
  text: string,
}) satisfies Validator<JiraContent>;

export function jiraAttrsOf(record: IndexRecord): JiraAttrs | null {
  if (parseItemId(record.id)?.kind !== "jira") return null;
  const parsed = jiraAttrs(record.attrs);
  return parsed.ok ? parsed.value : null;
}

export const jiraKeyShape = /^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/;

export function isJiraId(id: string): id is ItemId<"jira"> {
  const parsed = parseItemId(id);
  return parsed?.kind === "jira" && jiraKeyShape.test(parsed.key);
}

export const jiraPresentation: Presentation = {
  name: "Jira",
  inSentence: "Jira",
  icon: "ticket",
  keysReadAs: null,
  columns: issueColumns,
  details: issueDetails,
};

// The hierarchy decides where Jira gives one: an epic-level type is an epic whatever the site calls it, and a sub-task is a sub-task.
export function jiraKind(type: { name: string; subtask?: boolean; hierarchyLevel?: number }) {
  if (type.hierarchyLevel === 1) return "epic";
  if (type.subtask === true || type.hierarchyLevel === -1) return "subtask";
  return type.name.toLowerCase();
}

// Remote links aren't here: Jira's search doesn't return them, and a read per issue on every sync costs too much.
export function jiraIssueFields(item: {
  type: { name: string; subtask?: boolean; hierarchyLevel?: number };
  status: { name: string; category: State };
  epic: { id: ItemId<"jira">; stableId: string } | null;
  parent: { id: ItemId<"jira">; stableId: string } | null;
  assignee: { accountId: string; name: string } | null;
  points: number | null | undefined;
  labels: readonly string[];
  updatedAt: Instant;
}): IssueFields {
  return {
    kind: jiraKind(item.type),
    type: item.type.name,
    container: item.epic,
    parent: item.parent,
    status: item.status,
    assignee: item.assignee && { id: item.assignee.accountId, name: item.assignee.name },
    ...(item.points === undefined ? {} : { estimate: item.points }),
    labels: [...item.labels],
    updatedAt: item.updatedAt,
  };
}

export function jiraText(item: Pick<JiraContent, "summary" | "description" | "comments">): string {
  return [
    item.summary,
    item.description,
    ...item.comments.map((comment) => `${comment.author}, ${comment.at}:\n${comment.body}`),
  ]
    .filter((part) => part.trim() !== "")
    .join("\n\n");
}
