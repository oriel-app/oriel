// A Jira issue as the panel beside the page shows it, from a live read: its
// type, status, assignee and estimate, its description and its comments.
import type { PanelBlock, PanelOf, PanelProse } from "@oriel/core";
import { adfToProse } from "./adf.ts";
import { jiraContent } from "./attrs.ts";

// Rich text written with structure keeps it, read into typed blocks; none
// when it is plain text, which stays as written.
const proseOf = (doc: unknown): PanelProse[] => (doc === undefined ? [] : adfToProse(doc));

export const jiraPanel: PanelOf = (content) => {
  const read = jiraContent(content);
  if (!read.ok) return null;
  const issue = read.value;
  const prose = proseOf(issue.descriptionDoc);
  const blocks: PanelBlock[] = [
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
    // Otherwise it is plain text, which stays as written.
    prose.length > 0
      ? { kind: "rich", heading: "Description", prose }
      : {
          kind: "text",
          heading: "Description",
          text: issue.description === "" ? "No description." : issue.description,
          format: "plain",
        },
    {
      kind: "messages",
      heading: "Comments",
      messages: issue.comments.map((comment) => {
        const prose = proseOf(comment.bodyDoc);
        return {
          author: comment.author,
          at: comment.at,
          text: comment.body,
          ...(prose.length > 0 ? { prose } : {}),
        };
      }),
      empty: "No comments.",
    },
  ];
  return { title: null, blocks };
};
