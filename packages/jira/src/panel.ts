import { issueFacts, type PanelBlock, type PanelOf, type PanelProse } from "@oriel/core";
import { adfToProse } from "./adf.ts";
import { jiraContent } from "./attrs.ts";

const proseOf = (doc: unknown): PanelProse[] => (doc === undefined ? [] : adfToProse(doc));

export const jiraPanel: PanelOf = (content) => {
  const read = jiraContent(content);
  if (!read.ok) return null;
  const issue = read.value;
  const prose = proseOf(issue.descriptionDoc);
  const blocks: PanelBlock[] = [
    issueFacts({
      type: issue.issueType,
      status: issue.status,
      assignee: issue.assignee && { id: issue.assignee.accountId, name: issue.assignee.name },
      ...(issue.points === undefined ? {} : { estimate: issue.points }),
      labels: issue.labels,
    }),
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
