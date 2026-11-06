// How change sets treat the stand-in tracker's ops. Field names are those
// its writer reports in `current`, `before` and `after`:
// - `summary`, `description` ("" when empty), `points`, `assignee` (a name),
//   `status` (its name), `epic` (an item ID) and `labels`;
// - `label:<label>`: whether it has that label;
// - `updated`: its last update, an instant, in every `after` but a delete's.
// A set op's one argument sets one field, so its revert restores
// `applied.before[field]`.
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
import { issueFields, type TrackerOp, trackerOps } from "./ops.ts";

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
  if (subject === null) return "a new story";
  if (subject.kind === "new")
    return subject.title === null ? "the new story" : `the new story ${quoted(subject.title)}`;
  return subject.title === null ? key(subject.id) : `${quoted(subject.title)} (${key(subject.id)})`;
}

const estimate = (points: unknown) =>
  typeof points !== "number" ? "no estimate" : points === 1 ? "1 point" : `${points} points`;

// A set op's revert: the same op, with the value the tracker had before.
function restore<T>(name: string, field: string, validator: Validator<T>, arg = field) {
  return (_args: T, applied: WriteResult): Undo => {
    if (!Object.hasOwn(applied.before, field))
      return { refused: `the tracker didn't keep the earlier ${field}` };
    const result = validator({ [arg]: applied.before[field] });
    if (!result.ok) return { refused: `the earlier ${field} can't be set back` };
    return { op: name, args: result.value };
  };
}

const ops: Record<TrackerOp, OpSpec> = {
  createEpic: op(trackerOps.createEpic, {
    creates: true,
    makes: "epic",
    after: (a) => ({
      summary: a.summary,
      ...(a.description === undefined ? {} : { description: a.description }),
    }),
    describe: (a) => `Create an epic ${quoted(a.summary)}.`,
    undo: () => ({ op: "deleteItem", args: {} }),
  }),
  createStory: op(trackerOps.createStory, {
    creates: true,
    makes: "story",
    refs: (a) => (a.epic === null ? [] : [a.epic]),
    newRefArgs: { epic: "createEpic" },
    after: (a) => ({
      summary: a.summary,
      ...(a.description === undefined ? {} : { description: a.description }),
      ...(a.points === undefined ? {} : { points: a.points }),
      epic: a.epic,
    }),
    describe: async (a, context) => {
      let epic = "";
      if (a.epic !== null) {
        const title = isNewRef(a.epic) || isItemId(a.epic) ? await context.title(a.epic) : null;
        epic = isNewRef(a.epic)
          ? title === null
            ? " in the new epic"
            : ` in the new epic ${quoted(title)}`
          : title === null
            ? ` in the epic ${key(a.epic)}`
            : ` in the epic ${quoted(title)} (${key(a.epic)})`;
      }
      const points = typeof a.points === "number" ? `, estimated at ${estimate(a.points)}` : "";
      return `Create a story ${quoted(a.summary)}${epic}${points}.`;
    },
    undo: () => ({ op: "deleteItem", args: {} }),
  }),
  setSummary: op(trackerOps.setSummary, {
    idempotent: true,
    after: (a) => ({ summary: a.summary }),
    describe: (a, context) => `Rename ${named(context.subject)} to ${quoted(a.summary)}.`,
    undo: restore("setSummary", "summary", trackerOps.setSummary.args),
  }),
  setDescription: op(trackerOps.setDescription, {
    idempotent: true,
    after: (a) => ({ description: a.description }),
    describe: (a, context) => {
      const was = context.before.description;
      if (a.description.trim() === "") return `Clear the description of ${named(context.subject)}.`;
      if (typeof was !== "string" || was.trim() === "")
        return `Add a description to ${named(context.subject)}.`;
      return `Rewrite the description of ${named(context.subject)}.`;
    },
    undo: restore("setDescription", "description", trackerOps.setDescription.args),
  }),
  setEstimate: op(trackerOps.setEstimate, {
    idempotent: true,
    after: (a) => ({ points: a.points }),
    describe: (a, context) => {
      const was = context.before.points;
      const item = named(context.subject);
      if (a.points === null)
        return typeof was === "number"
          ? `Remove the estimate from ${item} (it was ${estimate(was)}).`
          : `Remove the estimate from ${item}.`;
      if (typeof was !== "number") return `Estimate ${item} at ${estimate(a.points)}.`;
      return `Change the estimate of ${item} from ${estimate(was)} to ${estimate(a.points)}.`;
    },
    undo: restore("setEstimate", "points", trackerOps.setEstimate.args),
  }),
  setAssignee: op(trackerOps.setAssignee, {
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
    undo: restore("setAssignee", "assignee", trackerOps.setAssignee.args, "name"),
  }),
  setStatus: op(trackerOps.setStatus, {
    idempotent: true,
    after: (a) => ({ status: a.status }),
    describe: (a, context) => {
      const was = context.before.status;
      const item = named(context.subject);
      if (typeof was !== "string") return `Move ${item} to ${a.status}.`;
      if (was === a.status) return `Leave ${item} in ${a.status}.`;
      return `Move ${item} from ${was} to ${a.status}.`;
    },
    undo: restore("setStatus", "status", trackerOps.setStatus.args),
  }),
  addLabel: op(trackerOps.addLabel, {
    idempotent: true,
    after: (a) => ({ [`label:${a.label}`]: true }),
    describe: (a, context) => `Add the label ${quoted(a.label)} to ${named(context.subject)}.`,
    // One it had already stays.
    undo: (a, applied) =>
      applied.before[`label:${a.label}`] === true
        ? { op: "addLabel", args: { label: a.label } }
        : { op: "removeLabel", args: { label: a.label } },
  }),
  removeLabel: op(trackerOps.removeLabel, {
    idempotent: true,
    after: (a) => ({ [`label:${a.label}`]: false }),
    describe: (a, context) => `Remove the label ${quoted(a.label)} from ${named(context.subject)}.`,
    undo: (a) => ({ op: "addLabel", args: { label: a.label } }),
  }),
  deleteItem: op(trackerOps.deleteItem, {
    deletes: true,
    after: () => ({}),
    describe: (_a, context) => `Delete ${named(context.subject)} from Oriel's tracker.`,
    undo: () => ({ refused: "a deleted item can't be restored by a revert" }),
  }),
};

// What the composition root hands change sets for the tracker.
export const trackerSpecs: OpSpecs = {
  name: "Tracker",
  titleField: "summary",
  updatedField: "updated",
  fields: Object.fromEntries(issueFields.map((f) => [f, f === "epic" ? "item" : "value"])),
  ops,
};
