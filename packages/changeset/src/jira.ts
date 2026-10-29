import {
  type FieldValues,
  isItemId,
  jiraOps,
  parseItemId,
  type Validator,
  type WriteResult,
} from "@oriel/core";
import { type Catalogue, type LineContext, op, type Subject, type Undo } from "./catalogue.ts";

// How change sets treat Jira's ops. Field names are shared with the Jira
// reader and writer (their `current`, `before` and `after`):
// - `summary`, `description` ("" when empty), `points`, `epic` (an item ID)
//   and `accountId` (the assignee);
// - `link:<linkId>`: a remote link as `{ url, title }`, or null once removed.
// A set op's one argument key is the field it sets, so its revert restores
// `applied.before[key]`.

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

function host(url: string): string {
  try {
    return new URL(url).host || quoted(url);
  } catch {
    return quoted(url);
  }
}

async function who(context: LineContext, accountId: string): Promise<string> {
  return (await context.person(accountId)) ?? "a person Oriel can't name";
}

function linkField(values: FieldValues): string | null {
  return Object.keys(values).find((field) => field.startsWith("link:")) ?? null;
}

// A set op's revert: the same op, with the value the source reported before.
function restore<T>(name: string, field: string, validator: Validator<T>) {
  return (_args: T, applied: WriteResult): Undo => {
    if (!Object.hasOwn(applied.before, field))
      return { refused: `Jira didn't report the earlier ${field}` };
    const result = validator({ [field]: applied.before[field] });
    if (!result.ok) return { refused: `the earlier ${field} can't be set back` };
    return { op: name, args: result.value };
  };
}

export const jiraCatalogue: Catalogue = {
  name: "Jira",
  titleField: "summary",
  ops: {
    createStory: op({
      args: jiraOps.createStory,
      creates: true,
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
    setSummary: op({
      args: jiraOps.setSummary,
      after: (a) => ({ summary: a.summary }),
      describe: (a, context) => `Rename ${named(context.subject)} to ${quoted(a.summary)}.`,
      undo: restore("setSummary", "summary", jiraOps.setSummary),
    }),
    setDescription: op({
      args: jiraOps.setDescription,
      after: (a) => ({ description: a.description }),
      describe: (a, context) => {
        const was = context.before.description;
        if (a.description.trim() === "")
          return `Clear the description of ${named(context.subject)}.`;
        if (typeof was !== "string" || was.trim() === "")
          return `Add a description to ${named(context.subject)}.`;
        return `Rewrite the description of ${named(context.subject)}.`;
      },
      undo: restore("setDescription", "description", jiraOps.setDescription),
    }),
    setEstimate: op({
      args: jiraOps.setEstimate,
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
      undo: restore("setEstimate", "points", jiraOps.setEstimate),
    }),
    setAssignee: op({
      args: jiraOps.setAssignee,
      after: (a) => ({ accountId: a.accountId }),
      describe: async (a, context) => {
        const was = context.before.accountId;
        const item = named(context.subject);
        if (a.accountId === null)
          return typeof was === "string"
            ? `Unassign ${item} (it was assigned to ${await who(context, was)}).`
            : `Leave ${item} unassigned.`;
        if (typeof was !== "string") return `Assign ${item} to ${await who(context, a.accountId)}.`;
        return `Reassign ${item} from ${await who(context, was)} to ${await who(context, a.accountId)}.`;
      },
      undo: restore("setAssignee", "accountId", jiraOps.setAssignee),
    }),
    addLink: op({
      args: jiraOps.addLink,
      after: (a) => ({ link: { url: a.url, title: a.title } }),
      describe: (a, context) =>
        `Add the link ${quoted(a.title)} (${host(a.url)}) to ${named(context.subject)}.`,
      undo: (_a, applied) => {
        const field = linkField(applied.after);
        if (field === null) return { refused: "Jira didn't report which link it added" };
        return { op: "removeLink", args: { linkId: field.slice("link:".length) } };
      },
    }),
    removeLink: op({
      args: jiraOps.removeLink,
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
    deleteItem: op({
      args: jiraOps.deleteItem,
      after: () => ({}),
      describe: (_a, context) => `Delete ${named(context.subject)} from Jira.`,
      undo: () => ({ refused: "a deleted item can't be restored by a revert" }),
    }),
  },
};
