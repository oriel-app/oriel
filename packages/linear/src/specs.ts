// How change sets treat Linear's ops, in Linear's words. Field names are
// those its writer reports in `current`, `before` and `after` (ops.ts):
// `summary`, `description`, `points`, `assignee` (a name), `status` (its
// name), `cycle` (its number), `epic` (its project's item ID), `labels`,
// `label:<label>` (whether it has it) and `updated`. A set op's one argument
// sets one field, so its revert restores `applied.before[field]`.
import {
  isItemId,
  isNewRef,
  op,
  type OpSpec,
  type OpSpecs,
  parseItemId,
  type Subject,
  type Undo,
  type Validator,
  type WriteResult,
} from "@oriel/core";
import { type LinearOp, linearFields, linearOps } from "./ops.ts";

const maxTitleChars = 80;

function quoted(text: string): string {
  const chars = [...text.replace(/\s+/g, " ").trim()];
  const short =
    chars.length > maxTitleChars
      ? `${chars.slice(0, maxTitleChars - 1).join("")}…`
      : chars.join("");
  return `“${short}”`;
}

const key = (id: string) => parseItemId(id)?.key ?? id;

function named(subject: Subject): string {
  if (subject === null) return "a new issue";
  if (subject.kind === "new")
    return subject.title === null ? "the new item" : `the new item ${quoted(subject.title)}`;
  return subject.title === null ? key(subject.id) : `${quoted(subject.title)} (${key(subject.id)})`;
}

const estimated = (points: unknown) =>
  typeof points !== "number" ? "no estimate" : points === 1 ? "1 point" : `${points} points`;
const cycled = (cycle: unknown) => (typeof cycle === "number" ? `cycle ${cycle}` : "no cycle");

// A set op's revert: the same op, with the value Linear had before.
function restore<T>(name: string, field: string, validator: Validator<T>, arg = field) {
  return (_args: T, applied: WriteResult): Undo => {
    if (!Object.hasOwn(applied.before, field))
      return { refused: `Linear didn't give the earlier ${field}` };
    const result = validator({ [arg]: applied.before[field] });
    if (!result.ok) return { refused: `the earlier ${field} can't be set back` };
    return { op: name, args: result.value };
  };
}

const ops: Record<LinearOp, OpSpec> = {
  createProject: op(linearOps.createProject, {
    creates: true,
    makes: "project",
    after: (a) => ({
      summary: a.name,
      ...(a.description === undefined ? {} : { description: a.description }),
    }),
    describe: (a) => `Create a project ${quoted(a.name)} in Linear.`,
    undo: () => ({ op: "deleteItem", args: {} }),
  }),
  createIssue: op(linearOps.createIssue, {
    creates: true,
    makes: "issue",
    refs: (a) => (a.project === null ? [] : [a.project]),
    newRefArgs: { project: "createProject" },
    after: (a) => ({
      summary: a.title,
      ...(a.description === undefined ? {} : { description: a.description }),
      ...(a.estimate === undefined ? {} : { points: a.estimate }),
      ...(a.cycle === undefined ? {} : { cycle: a.cycle }),
      epic: a.project,
    }),
    describe: async (a, context) => {
      let project = "";
      if (a.project !== null) {
        const title =
          isNewRef(a.project) || isItemId(a.project) ? await context.title(a.project) : null;
        project = isNewRef(a.project)
          ? title === null
            ? " in the new project"
            : ` in the new project ${quoted(title)}`
          : title === null
            ? ` in the project ${key(a.project)}`
            : ` in the project ${quoted(title)}`;
      }
      const points =
        typeof a.estimate === "number" ? `, estimated at ${estimated(a.estimate)}` : "";
      const cycle = typeof a.cycle === "number" ? `, in ${cycled(a.cycle)}` : "";
      return `Create an issue ${quoted(a.title)}${project}${points}${cycle}.`;
    },
    undo: () => ({ op: "deleteItem", args: {} }),
  }),
  setTitle: op(linearOps.setTitle, {
    idempotent: true,
    after: (a) => ({ summary: a.title }),
    describe: (a, context) => `Rename ${named(context.subject)} to ${quoted(a.title)}.`,
    undo: restore("setTitle", "summary", linearOps.setTitle.args, "title"),
  }),
  setDescription: op(linearOps.setDescription, {
    idempotent: true,
    after: (a) => ({ description: a.description }),
    describe: (a, context) => {
      const was = context.before.description;
      if (a.description.trim() === "") return `Clear the description of ${named(context.subject)}.`;
      if (typeof was !== "string" || was.trim() === "")
        return `Add a description to ${named(context.subject)}.`;
      return `Rewrite the description of ${named(context.subject)}.`;
    },
    undo: restore("setDescription", "description", linearOps.setDescription.args),
  }),
  setEstimate: op(linearOps.setEstimate, {
    idempotent: true,
    after: (a) => ({ points: a.estimate }),
    describe: (a, context) => {
      const was = context.before.points;
      const item = named(context.subject);
      if (a.estimate === null)
        return typeof was === "number"
          ? `Remove the estimate from ${item} (it was ${estimated(was)}).`
          : `Remove the estimate from ${item}.`;
      if (typeof was !== "number") return `Estimate ${item} at ${estimated(a.estimate)}.`;
      return `Change the estimate of ${item} from ${estimated(was)} to ${estimated(a.estimate)}.`;
    },
    undo: restore("setEstimate", "points", linearOps.setEstimate.args, "estimate"),
  }),
  setAssignee: op(linearOps.setAssignee, {
    idempotent: true,
    after: (a) => ({ assignee: a.name }),
    describe: (a, context) => {
      const was = context.before.assignee;
      const item = named(context.subject);
      if (a.name === null)
        return typeof was === "string"
          ? `Unassign ${item} (it was assigned to ${was}).`
          : `Leave ${item} unassigned.`;
      if (typeof was !== "string") return `Assign ${item} to ${a.name}.`;
      return `Reassign ${item} from ${was} to ${a.name}.`;
    },
    undo: restore("setAssignee", "assignee", linearOps.setAssignee.args, "name"),
  }),
  setStatus: op(linearOps.setStatus, {
    idempotent: true,
    after: (a) => ({ status: a.status }),
    describe: (a, context) => {
      const was = context.before.status;
      const item = named(context.subject);
      if (typeof was !== "string") return `Move ${item} to ${a.status}.`;
      if (was === a.status) return `Leave ${item} in ${a.status}.`;
      return `Move ${item} from ${was} to ${a.status}.`;
    },
    undo: restore("setStatus", "status", linearOps.setStatus.args),
  }),
  setCycle: op(linearOps.setCycle, {
    idempotent: true,
    after: (a) => ({ cycle: a.cycle }),
    describe: (a, context) => {
      const was = context.before.cycle;
      const item = named(context.subject);
      if (a.cycle === null)
        return typeof was === "number"
          ? `Take ${item} out of ${cycled(was)}.`
          : `Leave ${item} in no cycle.`;
      if (typeof was !== "number") return `Plan ${item} into ${cycled(a.cycle)}.`;
      return `Move ${item} from ${cycled(was)} to ${cycled(a.cycle)}.`;
    },
    undo: restore("setCycle", "cycle", linearOps.setCycle.args),
  }),
  addLabel: op(linearOps.addLabel, {
    idempotent: true,
    after: (a) => ({ [`label:${a.label}`]: true }),
    describe: (a, context) => `Add the label ${quoted(a.label)} to ${named(context.subject)}.`,
    // One it had already stays.
    undo: (a, applied) =>
      applied.before[`label:${a.label}`] === true
        ? { op: "addLabel", args: { label: a.label } }
        : { op: "removeLabel", args: { label: a.label } },
  }),
  removeLabel: op(linearOps.removeLabel, {
    idempotent: true,
    after: (a) => ({ [`label:${a.label}`]: false }),
    describe: (a, context) => `Remove the label ${quoted(a.label)} from ${named(context.subject)}.`,
    undo: (a) => ({ op: "addLabel", args: { label: a.label } }),
  }),
  deleteItem: op(linearOps.deleteItem, {
    deletes: true,
    after: () => ({}),
    describe: (_a, context) => `Delete ${named(context.subject)} from Linear.`,
    undo: () => ({ refused: "a deleted item can't be restored by a revert" }),
  }),
};

// What the composition root hands change sets for Linear.
export const linearSpecs: OpSpecs = {
  name: "Linear",
  titleField: "summary",
  updatedField: "updated",
  fields: Object.fromEntries(linearFields.map((f) => [f, f === "epic" ? "item" : "value"])),
  ops,
};
