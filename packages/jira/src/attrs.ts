// What the index keeps per Jira item, and the full content read live, with
// the index's shape as a validator for the index store and the sync worker.
import {
  array,
  type Instant,
  type ItemId,
  literal,
  nullable,
  number,
  object,
  parseItemId,
  refine,
  string,
  union,
  type Validator,
} from "@oriel/core";

// Enough for grouping (epic, assignee, stuck) and the window's filters,
// nothing more.
export type JiraAttrs = {
  issueType: string;
  status: { name: string; category: "todo" | "in-progress" | "done" };
  epic: ItemId<"jira"> | null;
  assignee: { accountId: string; name: string } | null;
  points: number | null;
  labels: string[];
};

// Full content, read live at run time. Rich text arrives as plain text.
export type JiraContent = JiraAttrs & {
  summary: string;
  description: string;
  comments: { author: string; body: string; at: Instant }[];
  links: { linkId: string; url: string; title: string }[];
};

export const jiraAttrs = object({
  issueType: string,
  status: object({
    name: string,
    category: union(literal("todo"), literal("in-progress"), literal("done")),
  }),
  epic: nullable(
    refine(
      string,
      (id): id is ItemId<"jira"> => parseItemId(id)?.source === "jira",
      "expected a Jira item ID",
    ),
  ),
  assignee: nullable(object({ accountId: string, name: string })),
  points: nullable(number),
  labels: array(string),
}) satisfies Validator<JiraAttrs>;
