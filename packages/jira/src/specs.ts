import {
  type FieldValues,
  isItemId,
  type LineContext,
  op,
  type OpSpec,
  type OpSpecs,
  parseItemId,
  type Subject,
  type Undo,
  type Validator,
  type WriteResult,
} from "@oriel/core";
import { type JiraOp, jiraOps } from "./ops.ts";

// How change sets treat Jira's ops. Field names are core's (`FieldValues`),
// as the Jira writer reports them in `current`, `before` and `after`:
// - `summary`, `description` ("" when empty), `points`, `epic` (an item ID)
//   and `assignee` (an account ID);
// - `link:<linkId>`: a remote link as `{ url, title }`, or null once removed;
// - `updated`: the item's last update time, an instant. Every `after` carries
//   it except deleteItem's, and `current(id, ["updated"])` returns it.
// A set op's one argument sets one field, so its revert restores
// `applied.before[field]` under that argument's key.

const maxTitleChars = 80;

function quoted(text: string): string {
  const chars = [...text.replace(/\s+/g, " ").trim()];
  const short =
    chars.length > maxTitleChars
      ? `${chars.slice(0, maxTitleChars - 1).join("")}…`
      : chars.join("");
  return `“${short}”`;
}

function key(id: string): string {
  return parseItemId(id)?.key ?? id;
}

function named(subject: Subject): string {
  if (subject === null) return "a new story";
  if (subject.kind === "new")
    return subject.title === null ? "the new story" : `the new story ${quoted(subject.title)}`;
  return subject.title === null ? key(subject.id) : `${quoted(subject.title)} (${key(subject.id)})`;
}

function estimate(points: unknown): string {
  if (typeof points !== "number") return "no estimate";
  return points === 1 ? "1 point" : `${points} points`;
}

// Where a link goes: the host of a web address, or else the whole URL, so a
// `javascript:` link can't pass for the host it names.
function destination(url: string): string {
  try {
    const parsed = new URL(url);
    if ((parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.host)
      return parsed.host;
  } catch {
    // Not a URL at all; shown whole below.
  }
  return `“${url}”`;
}

async function who(context: LineContext, accountId: string): Promise<string> {
  return (await context.person(accountId)) ?? "a person Oriel can't name";
}

function linkField(values: FieldValues): string | null {
  return Object.keys(values).find((field) => field.startsWith("link:")) ?? null;
}

// A set op's revert: the same op, with the value the source reported before.
// `arg` is the argument that sets `field`, when its name differs.
function restore<T>(name: string, field: string, validator: Validator<T>, arg = field) {
  return (_args: T, applied: WriteResult): Undo => {
    if (!Object.hasOwn(applied.before, field))
      return { refused: `Jira didn't report the earlier ${field}` };
    const result = validator({ [arg]: applied.before[field] });
    if (!result.ok) return { refused: `the earlier ${field} can't be set back` };
    return { op: name, args: result.value };
  };
}

// One entry per op in Jira's own catalogue, which supplies each one's
// arguments and whether it exists only as a revert.
const ops: Record<JiraOp, OpSpec> = {
  createStory: op(jiraOps.createStory, {
    creates: true,
    refs: (a) => (a.epic === null ? [] : [a.epic]),
    after: (a) => ({
      summary: a.summary,
      ...(a.description === undefined ? {} : { description: a.description }),
      ...(a.points === undefined ? {} : { points: a.points }),
      epic: a.epic,
    }),
    describe: async (a, context) => {
      let epic = "";
      if (a.epic !== null) {
        const title = isItemId(a.epic) ? await context.title(a.epic) : null;
        epic =
          title === null
            ? ` in the epic ${key(a.epic)}`
            : ` in the epic ${quoted(title)} (${key(a.epic)})`;
      }
      const points = typeof a.points === "number" ? `, estimated at ${estimate(a.points)}` : "";
      return `Create a story ${quoted(a.summary)}${epic}${points}.`;
    },
    undo: () => ({ op: "deleteItem", args: {} }),
  }),
  setSummary: op(jiraOps.setSummary, {
    idempotent: true,
    after: (a) => ({ summary: a.summary }),
    describe: (a, context) => `Rename ${named(context.subject)} to ${quoted(a.summary)}.`,
    undo: restore("setSummary", "summary", jiraOps.setSummary.args),
  }),
  setDescription: op(jiraOps.setDescription, {
    idempotent: true,
    after: (a) => ({ description: a.description }),
    describe: (a, context) => {
      const was = context.before.description;
      if (a.description.trim() === "") return `Clear the description of ${named(context.subject)}.`;
      if (typeof was !== "string" || was.trim() === "")
        return `Add a description to ${named(context.subject)}.`;
      return `Rewrite the description of ${named(context.subject)}.`;
    },
    undo: restore("setDescription", "description", jiraOps.setDescription.args),
  }),
  setEstimate: op(jiraOps.setEstimate, {
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
    undo: restore("setEstimate", "points", jiraOps.setEstimate.args),
  }),
  setAssignee: op(jiraOps.setAssignee, {
    idempotent: true,
    after: (a) => ({ assignee: a.accountId }),
    describe: async (a, context) => {
      const was = context.before.assignee;
      const item = named(context.subject);
      if (a.accountId === null)
        return typeof was === "string"
          ? `Unassign ${item} (it was assigned to ${await who(context, was)}).`
          : `Leave ${item} unassigned.`;
      if (typeof was !== "string") return `Assign ${item} to ${await who(context, a.accountId)}.`;
      return `Reassign ${item} from ${await who(context, was)} to ${await who(context, a.accountId)}.`;
    },
    undo: restore("setAssignee", "assignee", jiraOps.setAssignee.args, "accountId"),
  }),
  addLink: op(jiraOps.addLink, {
    // Jira names the link when it adds it; until then it is `link:new`.
    after: (a) => ({ "link:new": { url: a.url, title: a.title } }),
    describe: (a, context) =>
      `Add the link ${quoted(a.title)} (${destination(a.url)}) to ${named(context.subject)}.`,
    undo: (_a, applied) => {
      const field = linkField(applied.after);
      if (field === null) return { refused: "Jira didn't report which link it added" };
      return { op: "removeLink", args: { linkId: field.slice("link:".length) } };
    },
  }),
  removeLink: op(jiraOps.removeLink, {
    after: (a) => ({ [`link:${a.linkId}`]: null }),
    describe: (a, context) => {
      const link = context.before[`link:${a.linkId}`];
      const title =
        typeof link === "object" &&
        link !== null &&
        "title" in link &&
        typeof link.title === "string"
          ? link.title
          : null;
      return title === null
        ? `Remove a link from ${named(context.subject)}.`
        : `Remove the link ${quoted(title)} from ${named(context.subject)}.`;
    },
    undo: () => ({ refused: "a removed link can't be put back by a revert" }),
  }),
  deleteItem: op(jiraOps.deleteItem, {
    after: () => ({}),
    describe: (_a, context) => `Delete ${named(context.subject)} from Jira.`,
    undo: () => ({ refused: "a deleted item can't be restored by a revert" }),
  }),
};

// What the composition root hands change sets for Jira.
export const jiraSpecs: OpSpecs = {
  name: "Jira",
  titleField: "summary",
  updatedField: "updated",
  ops,
};
