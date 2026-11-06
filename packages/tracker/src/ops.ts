// The stand-in tracker's write operations. Each one that means what one of
// Jira's does has its name and arguments, so the agent's namespace reads the
// same for both; its assignee is a name, as it keeps people, and a label is
// added one at a time. Two exist only as reverts: removeLabel undoes
// addLabel, and deleteItem undoes createEpic and createStory.
import {
  array,
  type Infer,
  nullable,
  number,
  object,
  type OpCatalogue,
  optional,
  refine,
  string,
} from "@oriel/core";
import { isStatusName, statusNames } from "./issues.ts";

export const maxSummary = 255;
export const maxDescription = 32_767;
export const maxName = 120;
export const maxLabel = 60;
export const maxLabels = 20;

const short = (max: number, what: string) =>
  refine(
    string,
    (text) => text.trim() !== "" && [...text].length <= max,
    `expected ${what} of 1 to ${max} characters`,
  );
export const summary = short(maxSummary, "a summary");
export const description = refine(
  string,
  (text) => [...text].length <= maxDescription,
  `expected at most ${maxDescription} characters`,
);
export const personName = short(maxName, "a name");
// A label is one word people filter by, as trackers keep them.
export const label = refine(
  short(maxLabel, "a label"),
  (text) => !/\s/.test(text),
  "expected a label with no spaces",
);
export const labels = refine(
  array(label),
  (list) => list.length <= maxLabels && new Set(list).size === list.length,
  `expected at most ${maxLabels} labels, each once`,
);
export const points = refine(
  number,
  (n) => Number.isFinite(n) && n >= 0 && n <= 1000,
  "expected points from 0 to 1000",
);
export const status = refine(
  string,
  isStatusName,
  `expected one of ${statusNames.map((name) => JSON.stringify(name)).join(", ")}`,
);

export const trackerOps = {
  createEpic: {
    args: object({ summary, description: optional(description) }),
    revertOnly: false,
  },
  createStory: {
    args: object({
      summary,
      description: optional(description),
      points: optional(nullable(points)),
      epic: nullable(string),
    }),
    revertOnly: false,
  },
  setSummary: { args: object({ summary }), revertOnly: false },
  setDescription: { args: object({ description }), revertOnly: false },
  setEstimate: { args: object({ points: nullable(points) }), revertOnly: false },
  setAssignee: { args: object({ name: nullable(personName) }), revertOnly: false },
  setStatus: { args: object({ status }), revertOnly: false },
  addLabel: { args: object({ label }), revertOnly: false },
  removeLabel: { args: object({ label }), revertOnly: true },
  deleteItem: { args: object({}), revertOnly: true },
} as const satisfies OpCatalogue;

export type TrackerOp = keyof typeof trackerOps;
export type TrackerArgs<O extends TrackerOp> = Infer<(typeof trackerOps)[O]["args"]>;

// An issue's fields, by the names change sets read them under: what the
// writer reports before and after, and what a diff lists for a delete.
// `updated` is when it last changed, an instant.
export const issueFields = [
  "summary",
  "description",
  "points",
  "assignee",
  "status",
  "epic",
  "labels",
] as const;
