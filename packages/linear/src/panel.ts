// A Linear issue or project as the panel beside the page shows it, from a
// live read: its status, assignee, estimate and labels, and Linear's own
// extras, an issue's team, project, cycle and parent, a project's lead and
// target date; then its description, which Linear keeps as markdown.
import { issueFacts, type PanelBlock, type PanelOf } from "@oriel/core";
import { linearContent } from "./items.ts";

export const linearPanel: PanelOf = (content) => {
  const read = linearContent(content);
  if (!read.ok) return null;
  const item = read.value;
  // The facts name a status, never its category.
  const status = { name: item.status, category: "todo" as const };
  const facts: PanelBlock =
    item.kind === "issue"
      ? issueFacts({
          type: item.parent ? "Sub-issue" : "Issue",
          status,
          assignee: item.assignee === null ? null : { id: item.assignee, name: item.assignee },
          estimate: item.estimate,
          labels: item.labels,
        })
      : issueFacts({ type: "Project", status });
  const extras =
    item.kind === "issue"
      ? [
          { name: "Team", value: item.team },
          { name: "Project", value: item.project?.name ?? "No project" },
          {
            name: "Cycle",
            value: item.cycle
              ? `Cycle ${item.cycle.number}${item.cycle.name ? `, ${item.cycle.name}` : ""}`
              : "No cycle",
          },
          ...(item.parent ? [{ name: "Parent", value: item.parent }] : []),
        ]
      : [
          { name: "Lead", value: item.lead ?? "No lead" },
          { name: "Target date", value: item.targetDate ?? "None" },
        ];
  return {
    title: null,
    blocks: [
      { kind: "facts", facts: [...(facts.kind === "facts" ? facts.facts : []), ...extras] },
      {
        kind: "text",
        heading: "Description",
        text: item.description === "" ? "No description." : item.description,
        format: "markdown",
      },
    ],
  };
};
