// Core's `JiraAttrs` as a validator, for the index store and the sync worker.
import {
  array,
  type ItemId,
  type JiraAttrs,
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
