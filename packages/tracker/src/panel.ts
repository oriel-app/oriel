// A stand-in issue as the panel beside the page shows it, from a live read:
// its type, status, assignee, estimate and labels, its description, and the
// form a person edits it in, in place (decision 0059).
import { issueFacts, type PanelOf } from "@oriel/core";
import { trackerEdit } from "./edit.ts";
import { type Issue, isStatusName, statuses, trackerContent } from "./issues.ts";

export const trackerPanel: PanelOf = (content) => {
  const read = trackerContent(content);
  if (!read.ok || !isStatusName(read.value.status)) return null;
  const { kind, status, assignee, points, labels, description } = read.value;
  const category = statuses.find((each) => each.name === status)?.category ?? "todo";
  const issue: Issue = {
    ...read.value,
    status,
    epic: null,
    updatedAt: read.value.updatedAt as Issue["updatedAt"],
  };
  return {
    title: null,
    blocks: [
      issueFacts({
        type: kind === "epic" ? "Epic" : "Story",
        status: { name: status, category },
        assignee: assignee === null ? null : { id: assignee, name: assignee },
        ...(kind === "story" ? { estimate: points } : {}),
        labels,
      }),
      {
        kind: "text",
        heading: "Description",
        text: description === "" ? "No description." : description,
        format: "plain",
      },
    ],
    edit: trackerEdit(issue),
  };
};
