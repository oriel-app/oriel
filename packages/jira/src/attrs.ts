// What the index keeps per Jira item beyond core's facets, the full content
// read live, and validators for both. Facets carry the assignee (people), the
// status category (state) and the epic (container), so attrs hold only what
// is Jira's own.
import {
  array,
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
  refine,
  type State,
  string,
  union,
  type Validator,
} from "@oriel/core";

// Enough for the window and Jira's own rules (an epic, an estimate), nothing
// more.
export type JiraAttrs = {
  issueType: string;
  // The status as Jira names it; its category is the item's `state` facet.
  status: string;
  points: number | null;
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
  points: nullable(number),
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

// A record's Jira attrs, or null for another source's item. This is how a
// grouping reaches Jira's own fields; a rule built on them applies only to
// Jira items (decision 0019).
export function jiraAttrsOf(record: IndexRecord): JiraAttrs | null {
  if (parseItemId(record.id)?.source !== "jira") return null;
  const parsed = jiraAttrs(record.attrs);
  return parsed.ok ? parsed.value : null;
}

// The facets every Jira item has: its assignee, its status category, and its
// epic, by the epic's stable ID. Remote links aren't among them: Jira's search
// doesn't return them, and a read per issue on every sync costs too much.
// They are in the content a read returns.
export function jiraFacets(item: {
  category: State;
  epic: { id: ItemId<"jira">; stableId: string } | null;
  assignee: { accountId: string; name: string } | null;
}): Facets {
  return {
    people: item.assignee
      ? [{ role: "assignee", id: item.assignee.accountId, name: item.assignee.name }]
      : [],
    state: item.category,
    container: item.epic,
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
