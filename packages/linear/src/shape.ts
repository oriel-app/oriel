import {
  type Infer,
  issueShape,
  type IssueLines,
  type IssueOps,
  nullable,
  number,
  object,
  op,
  param,
  read,
  refine,
  shortText,
  string,
} from "@oriel/core";
import { isLinearId, linearContent } from "./items.ts";
import type { LinearContext } from "./open-connection.ts";

export const maxTitle = 255;
export const maxDescription = 32_767;
export const maxName = 120;
export const maxLabel = 60;

export const title = shortText(maxTitle, "a title");
export const projectName = shortText(maxTitle, "a name");
export const description = refine(
  string,
  (text) => [...text].length <= maxDescription,
  `expected at most ${maxDescription} characters`,
);
export const personName = shortText(maxName, "a name");
export const statusName = shortText(maxName, "a status");
export const label = shortText(maxLabel, "a label");
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

// Shape only, never source text.
export const linearItemDoc =
  "A Linear item is an issue or a project of one Linear team, its text its title and description. Issues are planned into the team's cycles.";

const cycled = (cycle: unknown) => (typeof cycle === "number" ? `cycle ${cycle}` : "no cycle");

// Status and cycle names are the source's text, so they come back here, never in a declaration.
const team = (context: LinearContext) =>
  read({
    name: "team",
    doc: "The team's statuses, by name and type, and its cycles' names.",
    params: [],
    returns:
      "{ statuses: readonly { name: string; type: string }[]; cycles: readonly { number: number; name: string | null }[] }",
    run: async () => ({
      statuses: context.world.statuses.map(({ name, type }) => ({ name, type })),
      cycles: context.world.cycles.map(({ number, name }) => ({ number, name })),
    }),
  });

// Cycles by number and date only: a cycle's name is the source's text, which only a tool result carries (team()).
function region(context: LinearContext | undefined) {
  if (!context) return undefined;
  const today = context.now.slice(0, 10);
  const statuses = context.world.statuses.map((status) => status.name);
  const toCome = context.world.cycles.filter((cycle) => cycle.endsAt > today);
  const numbers = toCome.map((cycle) => cycle.number);
  const when = toCome.map((cycle) =>
    cycle.startsAt <= today
      ? `${cycle.number} is under way until ${cycle.endsAt}`
      : `${cycle.number} starts ${cycle.startsAt}`,
  );
  const key = context.world.team.key;
  return {
    doc: `This region's Linear items: ${key}'s issues and projects.`,
    types: [
      `/** ${key}'s cycles to come, by number${when.length ? `: ${when.join("; ")}` : ""}. */`,
      `type LinearCycle = ${numbers.length ? numbers.map((each) => JSON.stringify(each)).join(" | ") : "never"};`,
    ],
    reads: [team(context)],
    allowed: {
      status: (status: unknown) => {
        if (typeof status === "string" && !statuses.includes(status))
          throw new RangeError(`${JSON.stringify(status)} isn't one of the team's statuses`);
      },
      cycle: (cycle: unknown) => {
        if (typeof cycle === "number" && !numbers.includes(cycle))
          throw new RangeError(`${cycle} isn't one of the team's cycles to come`);
      },
    },
  };
}

const setCycle = { args: object({ cycle: nullable(cycleNumber) }), revertOnly: false };

const declared = {
  kind: "linear",
  name: "Linear",
  called: "a Linear item",
  source: "Linear",
  unkept: "Linear didn't give",
  from: "Linear",
  is: isLinearId,
  container: {
    word: "project",
    a: "a project",
    plural: "projects",
    op: "createProject",
    title: "name",
    check: projectName,
    made: "a project for the team",
    in: " in Linear",
    keyed: false,
  },
  issue: { word: "issue", a: "an issue", plural: "issues", op: "createIssue", fresh: "item" },
  title: {
    op: "setTitle",
    arg: "title",
    check: title,
    doc: "Set an issue's or a project's title.",
    label: "Title",
  },
  description: { check: description, doc: "Replace an item's description, as markdown." },
  estimate: {
    arg: "estimate",
    check: estimate,
    doc: "Set an issue's estimate in points; null clears it.",
    label: "Estimate",
  },
  assignee: {
    arg: "name",
    check: personName,
    doc: "Assign an issue to a person by their full name; null unassigns.",
  },
  status: {
    check: statusName,
    doc: "Move an issue to one of the team's statuses, by its name, as team() gives them.",
    type: "string",
    declares: [],
  },
  label: { check: label, doc: "Add a label to an issue." },
  fields: {
    cycle: {
      item: { type: "number | null", doc: "Its cycle's number.", listed: "Cycle" },
      create: {
        type: "LinearCycle | null",
        check: nullable(cycleNumber),
        describe: (cycle: unknown) => (typeof cycle === "number" ? `, in ${cycled(cycle)}` : ""),
      },
    },
  },
  ops: {
    setCycle: {
      ...setCycle,
      write: {
        doc: "Plan an issue into a cycle to come; null takes it out.",
        params: [param("cycle", "LinearCycle | null", nullable(cycleNumber))],
      },
      spec: ({ named, restore }: IssueLines) =>
        op(setCycle, {
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
          undo: restore("setCycle", "cycle", setCycle.args),
        }),
    },
  },
  item: { kinds: ["issue", "project"], containerDoc: "Its project's ID, an issue's in one." },
  view: (content: unknown) => {
    const read = linearContent(content);
    if (!read.ok) return null;
    const c = read.value;
    const issue = c.kind === "issue" ? c : null;
    return {
      kind: c.kind,
      title: c.title,
      description: c.description,
      status: c.status,
      container: issue?.project?.id ?? null,
      fields: { cycle: issue?.cycle?.number ?? null },
      assignee: issue?.assignee ?? null,
      estimate: issue?.estimate ?? null,
      labels: issue?.labels ?? [],
    };
  },
  panel: (content: unknown) => {
    const read = linearContent(content);
    if (!read.ok) return null;
    const item = read.value;
    const status = { name: item.status, category: "todo" as const };
    return {
      ...(item.kind === "issue"
        ? {
            facts: {
              type: item.parent ? "Sub-issue" : "Issue",
              status,
              assignee: item.assignee === null ? null : { id: item.assignee, name: item.assignee },
              estimate: item.estimate,
              labels: item.labels,
            },
            more: [
              { name: "Team", value: item.team },
              { name: "Project", value: item.project?.name ?? "No project" },
              {
                name: "Cycle",
                value: item.cycle
                  ? `Cycle ${item.cycle.number}${item.cycle.name ? `, ${item.cycle.name}` : ""}`
                  : "No cycle",
              },
              ...(item.parent ? [{ name: "Parent", value: item.parent }] : []),
            ],
          }
        : {
            facts: { type: "Project", status },
            more: [
              { name: "Lead", value: item.lead ?? "No lead" },
              { name: "Target date", value: item.targetDate ?? "None" },
            ],
          }),
      description: item.description,
      format: "markdown" as const,
    };
  },
  region,
  // Whole and at most 64, as Linear takes an estimate.
  take: { maxTitle, estimate: (points: number) => Math.min(64, Math.round(points)) },
} as const;

export const linear = issueShape(declared);

export const linearOps = linear.ops;
export const linearSpecs = linear.specs;
export const isLinearOp = linear.isOp;
export const takeIssues = linear.takeIssues;
export type LinearOps = IssueOps<typeof declared>;
export type LinearOp = keyof LinearOps & string;
export type LinearArgs<O extends LinearOp> = Infer<LinearOps[O]["args"]>;
