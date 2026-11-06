// What the index keeps per Jira item, the full content read live, and
// validators for both. A Jira issue maps onto core's issues shape (decision
// 0059), whose facets and attrs every surface reads; what is Jira's own, such
// as its boards' points field, stays in this package.
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

// The issues shape's attrs: the issue type and status as the site names
// them, and the labels.
export type JiraAttrs = IssueAttrs;

export type JiraRecord = IndexRecord<"jira", JiraAttrs>;

// Full content, read live at run time. Rich text arrives as plain text, and
// a structured description or comment as Jira's rich text too, for the panel.
export type JiraContent = {
  issueType: string;
  status: { name: string; category: State };
  // The statuses its workflow lets it move to now.
  moves: { name: string; category: State }[];
  epic: ItemId<"jira"> | null;
  assignee: { accountId: string; name: string } | null;
  // Null when not estimated yet; absent when its board takes no estimates.
  points?: number | null;
  labels: string[];
  summary: string;
  description: string;
  // The description as Jira's rich text, for the panel, when it has more
  // than paragraphs of plain text: a list, a heading, code, a link, a mark.
  descriptionDoc?: unknown;
  // Each comment's body as rich text too, on the same terms.
  comments: { author: string; body: string; bodyDoc?: unknown; at: Instant }[];
  links: { linkId: string; url: string; title: string }[];
  // What any item's read returns: the summary as the title, and the summary,
  // description and comments as one plain text.
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

// A record's Jira attrs, or null for another source's item.
export function jiraAttrsOf(record: IndexRecord): JiraAttrs | null {
  if (parseItemId(record.id)?.kind !== "jira") return null;
  const parsed = jiraAttrs(record.attrs);
  return parsed.ok ? parsed.value : null;
}

// An issue's key, such as SYN-12: its project's key and its number.
export const jiraKeyShape = /^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/;

// An item ID of Jira's, from any Jira connection, with an issue's key.
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

// An issue type in core's words. The hierarchy decides where Jira gives one:
// an epic-level type is an epic whatever the site calls it, and a sub-task
// is a sub-task. Otherwise the type's own name, lowercased: "story", "task",
// "bug".
export function jiraKind(type: { name: string; subtask?: boolean; hierarchyLevel?: number }) {
  if (type.hierarchyLevel === 1) return "epic";
  if (type.subtask === true || type.hierarchyLevel === -1) return "subtask";
  return type.name.toLowerCase();
}

// A Jira issue in the issues shape: its type in core's words and the site's,
// its status and category, its epic as its container by the epic's stable
// ID, its parent where that isn't its epic, its assignee, its story points
// as its estimate, its labels and when it last changed. Points are
// undefined, and the issue has no estimate, when its project's board takes
// no estimates: it has none to lack. Remote links aren't among them: Jira's
// search doesn't return them, and a read per issue on every sync costs too
// much. They are in the content a read returns.
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

// The summary, the description and each comment with its author and time,
// separated by blank lines.
export function jiraText(item: Pick<JiraContent, "summary" | "description" | "comments">): string {
  return [
    item.summary,
    item.description,
    ...item.comments.map((comment) => `${comment.author}, ${comment.at}:\n${comment.body}`),
  ]
    .filter((part) => part.trim() !== "")
    .join("\n\n");
}
