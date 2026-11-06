// An issue's fields by the names change sets read them under (specs.ts),
// which its writer and a person's edits in its panel both report.
import type { FieldValues } from "@oriel/core";
import type { Issue } from "./issues.ts";

export const labelField = "label:";

// Its fields, each of `fields` it has: `label:<label>` says whether it has
// that label; an unknown name is left out.
export function valuesOf(issue: Issue, fields: readonly string[]): FieldValues {
  const all: Record<string, unknown> = {
    summary: issue.summary,
    description: issue.description,
    ...(issue.kind === "story" ? { points: issue.points } : {}),
    assignee: issue.assignee,
    status: issue.status,
    epic: issue.epic?.id ?? null,
    labels: [...issue.labels],
    updated: issue.updatedAt,
  };
  return Object.fromEntries(
    fields.flatMap((field) =>
      field.startsWith(labelField)
        ? [[field, issue.labels.includes(field.slice(labelField.length))]]
        : Object.hasOwn(all, field)
          ? [[field, all[field]]]
          : [],
    ),
  );
}
