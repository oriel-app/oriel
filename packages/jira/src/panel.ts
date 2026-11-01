// A Jira issue as the panel beside the page shows it, from a live read: its
// type, status, assignee and estimate, its description and its comments.
import type { PanelOf } from "@oriel/core";
import { jiraContent } from "./attrs.ts";

export const jiraPanel: PanelOf = (content) => {
  const read = jiraContent(content);
  if (!read.ok) return null;
  const issue = read.value;
  return [
    {
      kind: "facts",
      facts: [
        { name: "Type", value: issue.issueType },
        { name: "Status", value: issue.status.name },
        { name: "Assignee", value: issue.assignee?.name ?? "Unassigned" },
        // A board that takes no estimates has none to show, or to lack.
        ...(issue.points === undefined
          ? []
          : [
              {
                name: "Estimate",
                value:
                  issue.points === null
                    ? "Not estimated yet"
                    : `${issue.points} ${issue.points === 1 ? "point" : "points"}`,
              },
            ]),
        ...(issue.labels.length > 0 ? [{ name: "Labels", value: issue.labels.join(", ") }] : []),
      ],
    },
    // Rich text arrives as plain text, which stays as written.
    {
      kind: "text",
      heading: "Description",
      text: issue.description === "" ? "No description." : issue.description,
      format: "plain",
    },
    {
      kind: "messages",
      heading: "Comments",
      messages: issue.comments.map((comment) => ({
        author: comment.author,
        at: comment.at,
        text: comment.body,
      })),
      empty: "No comments.",
    },
  ];
};
