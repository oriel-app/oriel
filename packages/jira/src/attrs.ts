// What the index keeps per Jira item beyond core's facets, the full content
// read live, and validators for both. Facets carry the assignee (people), the
// status category (state), the epic (container), the issue type as a kind
// and the story points as an estimate, so attrs hold only what is Jira's own
// words for them, for the window.
import {
  array,
  type DetailsOf,
  type Facets,
  type IndexRecord,
  type Instant,
  isInstant,
  type ItemId,
  literal,
  nullable,
  number,
  object,
  parseItemId,
  type Presentation,
  refine,
  type State,
  string,
  union,
  type Validator,
} from "@oriel/core";

// Enough for the window, nothing more.
export type JiraAttrs = {
  // The issue type as the site names it; its `kind` facet is the type in
  // core's words.
  issueType: string;
  // The status as Jira names it; its category is the item's `state` facet.
  status: string;
  labels: string[];
};

export type JiraRecord = IndexRecord<"jira", JiraAttrs>;

// Full content, read live at run time. Rich text arrives as plain text.
export type JiraContent = {
  issueType: string;
  status: { name: string; category: State };
  epic: ItemId<"jira"> | null;
  assignee: { accountId: string; name: string } | null;
  points: number | null;
  labels: string[];
  summary: string;
  description: string;
  comments: { author: string; body: string; at: Instant }[];
  links: { linkId: string; url: string; title: string }[];
  // The summary, description and comments as one plain text, which is what
  // any item's read returns.
  text: string;
};

export const jiraAttrs = object({
  issueType: string,
  status: string,
  labels: array(string),
}) satisfies Validator<JiraAttrs>;

const jiraId = refine(
  string,
  (id): id is ItemId<"jira"> => parseItemId(id)?.source === "jira",
  "expected a Jira item ID",
);
const state = union(literal("todo"), literal("in-progress"), literal("done"));

// What a read returns, checked where it is used: a reader may sit behind any
// transport.
export const jiraContent = object({
  issueType: string,
  status: object({ name: string, category: state }),
  epic: nullable(jiraId),
  assignee: nullable(object({ accountId: string, name: string })),
  points: nullable(number),
  labels: array(string),
  summary: string,
  description: string,
  comments: array(
    object({
      author: string,
      body: string,
      at: refine(string, isInstant, "expected an instant"),
    }),
  ),
  links: array(object({ linkId: string, url: string, title: string })),
  text: string,
}) satisfies Validator<JiraContent>;

// A record's Jira attrs, or null for another source's item.
export function jiraAttrsOf(record: IndexRecord): JiraAttrs | null {
  if (parseItemId(record.id)?.source !== "jira") return null;
  const parsed = jiraAttrs(record.attrs);
  return parsed.ok ? parsed.value : null;
}

// How a Jira item shows in the window beyond core's fields: its issue type,
// status and labels as the site names them. The composition root passes this
// to the zoom levels.
export const jiraDetails: DetailsOf = (record) => {
  const attrs = jiraAttrsOf(record);
  return attrs && { type: attrs.issueType, status: attrs.status, labels: [...attrs.labels] };
};

export const jiraPresentation: Presentation = { name: "Jira", details: jiraDetails };

// An issue type in core's words. The hierarchy decides where Jira gives one:
// an epic-level type is an epic whatever the site calls it, and a sub-task
// is a sub-task. Otherwise the type's own name, lowercased: "story", "task",
// "bug".
export function jiraKind(type: { name: string; subtask?: boolean; hierarchyLevel?: number }) {
  if (type.hierarchyLevel === 1) return "epic";
  if (type.subtask === true || type.hierarchyLevel === -1) return "subtask";
  return type.name.toLowerCase();
}

// The facets every Jira item has: its assignee, its status category, its
// epic by the epic's stable ID, its issue type as a kind and its story points
// as an estimate. Remote links aren't among them: Jira's search doesn't
// return them, and a read per issue on every sync costs too much. They are
// in the content a read returns.
export function jiraFacets(item: {
  category: State;
  epic: { id: ItemId<"jira">; stableId: string } | null;
  assignee: { accountId: string; name: string } | null;
  kind: string;
  points: number | null;
}): Facets {
  return {
    people: item.assignee
      ? [{ role: "assignee", id: item.assignee.accountId, name: item.assignee.name }]
      : [],
    state: item.category,
    container: item.epic,
    kind: item.kind,
    estimate: item.points,
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
