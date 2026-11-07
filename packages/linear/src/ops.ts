// Linear's write operations, in Linear's words: a project, an issue in it,
// its title, estimate, assignee, status and cycle, and a label. Two exist
// only as reverts: removeLabel undoes addLabel, and deleteItem undoes a
// create, which no tool of Linear's server can send (writer.ts).
import {
  type Infer,
  nullable,
  number,
  object,
  type OpCatalogue,
  optional,
  refine,
  string,
} from "@oriel/core";

export const maxTitle = 255;
export const maxDescription = 32_767;
export const maxName = 120;
export const maxLabel = 60;

const short = (max: number, what: string) =>
  refine(
    string,
    (text) => text.trim() !== "" && [...text].length <= max,
    `expected ${what} of 1 to ${max} characters`,
  );
export const title = short(maxTitle, "a title");
export const projectName = short(maxTitle, "a name");
export const description = refine(
  string,
  (text) => [...text].length <= maxDescription,
  `expected at most ${maxDescription} characters`,
);
export const personName = short(maxName, "a name");
export const statusName = short(maxName, "a status");
export const label = short(maxLabel, "a label");
export const estimate = refine(
  number,
  (n) => Number.isInteger(n) && n >= 0 && n <= 64,
  "expected a whole estimate from 0 to 64",
);
export const cycleNumber = refine(
  number,
  (n) => Number.isInteger(n) && n > 0,
  "expected a cycle's number",
);

export const linearOps = {
  createProject: {
    args: object({ name: projectName, description: optional(description) }),
    revertOnly: false,
  },
  createIssue: {
    args: object({
      title,
      description: optional(description),
      estimate: optional(nullable(estimate)),
      cycle: optional(nullable(cycleNumber)),
      project: nullable(string),
    }),
    revertOnly: false,
  },
  setTitle: { args: object({ title }), revertOnly: false },
  setDescription: { args: object({ description }), revertOnly: false },
  setEstimate: { args: object({ estimate: nullable(estimate) }), revertOnly: false },
  setAssignee: { args: object({ name: nullable(personName) }), revertOnly: false },
  setStatus: { args: object({ status: statusName }), revertOnly: false },
  setCycle: { args: object({ cycle: nullable(cycleNumber) }), revertOnly: false },
  addLabel: { args: object({ label }), revertOnly: false },
  removeLabel: { args: object({ label }), revertOnly: true },
  deleteItem: { args: object({}), revertOnly: true },
} as const satisfies OpCatalogue;

export type LinearOp = keyof typeof linearOps;
export type LinearArgs<O extends LinearOp> = Infer<(typeof linearOps)[O]["args"]>;
export const isLinearOp = (op: string): op is LinearOp => Object.hasOwn(linearOps, op);

// Its fields, by the names change sets read them under (FieldValues):
// `summary` is a title or a project's name, `points` an estimate, `epic`
// an issue's project, by its item ID, and `cycle` its cycle's number.
export const linearFields = [
  "summary",
  "description",
  "points",
  "assignee",
  "status",
  "cycle",
  "epic",
  "labels",
] as const;
