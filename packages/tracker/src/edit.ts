// A person's own edit of an issue in its panel (decision 0059), applied at
// once, with an Undo that sets back what it replaced: the form's fields, by
// the names `trackerEdit` gives them, checked as the ops check them. Never
// the agent's: its writes are change sets.
import {
  nullable,
  object,
  optional,
  type PanelEdit,
  parseItemId,
  type Validator,
} from "@oriel/core";
import { inTurn, type Issue, issuesIn, statusNames } from "./issues.ts";
import { description, labels, personName, points, status, summary } from "./ops.ts";
import type { TrackerWrites } from "./open-connection.ts";

const editable = object({
  summary: optional(summary),
  description: optional(description),
  status: optional(status),
  points: optional(nullable(points)),
  assignee: optional(nullable(personName)),
  labels: optional(labels),
}) satisfies Validator<Partial<Record<keyof Values, unknown>>>;

type Values = Pick<Issue, "summary" | "description" | "status" | "points" | "assignee" | "labels">;
type Field = keyof Values;
const fields: readonly Field[] = [
  "summary",
  "description",
  "status",
  "points",
  "assignee",
  "labels",
];

// The form its panel shows: an epic takes no estimate.
export function trackerEdit(issue: Issue): PanelEdit {
  return {
    fields: [
      { name: "summary", label: "Summary", kind: "line", value: issue.summary },
      {
        name: "status",
        label: "Status",
        kind: "choice",
        value: issue.status,
        choices: [...statusNames],
      },
      {
        name: "assignee",
        label: "Assignee",
        kind: "person",
        value: issue.assignee,
        empty: "Unassigned",
      },
      ...(issue.kind === "story"
        ? [
            {
              name: "points",
              label: "Estimate",
              kind: "number" as const,
              value: issue.points,
              empty: "Not estimated yet",
            },
          ]
        : []),
      { name: "labels", label: "Labels", kind: "list", value: [...issue.labels] },
      { name: "description", label: "Description", kind: "text", value: issue.description },
    ],
  };
}

export function trackerEditor(writes: TrackerWrites) {
  const issues = issuesIn(writes.own);
  return (id: string, given: Readonly<Record<string, unknown>>) =>
    inTurn(writes.own, () => edit(id, given));
  async function edit(id: string, given: Readonly<Record<string, unknown>>) {
    const unknown = Object.keys(given).filter(
      (name) => !(fields as readonly string[]).includes(name),
    );
    if (unknown.length) throw new RangeError(`the tracker has no ${unknown.join(", ")} to edit`);
    const checked = editable(given);
    if (!checked.ok)
      throw new RangeError(checked.issues.map((i) => `${i.path}: ${i.message}`).join("; "));
    const parsed = parseItemId(id);
    const issue = parsed?.kind === "tracker" ? issues.byKey(parsed.key) : null;
    if (!issue) throw new RangeError(`${id} isn't in the tracker`);
    if (checked.value.points !== undefined && issue.kind === "epic")
      throw new RangeError(`${issue.key} is an epic, which takes no estimate`);
    const next: Partial<Values> = Object.fromEntries(
      fields.flatMap((field) => {
        const value = checked.value[field];
        return value === undefined || same(value, issue[field]) ? [] : [[field, value]];
      }),
    );
    const set = Object.keys(next) as Field[];
    const pick = (from: Values) => Object.fromEntries(set.map((field) => [field, from[field]]));
    if (!set.length) return { before: {}, after: {} };
    const after: Issue = { ...issue, ...next, updatedAt: writes.now() };
    await issues.put({ by: "person", change: "edited", fields: set }, [after]);
    return { before: pick(issue), after: pick(after) };
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
