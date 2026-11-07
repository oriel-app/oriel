// Linear's items as Oriel keeps them (OA-278): its issues, ENG-4, and its
// projects, P-5e2a9c41b7d0, each mapped onto core's issues shape (decision
// 0059). A project is what Browse's epic grouping hangs an issue off, as a
// Jira epic is; a sub-issue's parent is its issue. A team's cycles, a
// project's lead and target date, and an issue's team and cycle are Linear's
// own extras, in its read content and its panel.
import {
  array,
  type IndexRecord,
  type Infer,
  type IssueAttrs,
  type IssueFields,
  issueColumns,
  issueDetails,
  issueRecord,
  type ItemId,
  itemId,
  literal,
  nullable,
  number,
  object,
  parseItemId,
  type Presentation,
  ServerUnreadable,
  type State,
  string,
  union,
} from "@oriel/core";
import type { LinearCycle, LinearIssue, LinearProject, LinearStatus } from "./linear-mcp.ts";
import type { StatusType } from "./world.ts";

export const linearKind = "linear";

// An issue's key is its team's key and its number; a project's, its slug ID.
// Neither carries text a person wrote.
export const linearKeyShape = /^(?:[A-Z][A-Z0-9]{0,9}-[1-9][0-9]{0,8}|P-[0-9a-f]{12})$/;
const issueKeyShape = /^[A-Z][A-Z0-9]{0,9}-[1-9][0-9]{0,8}$/;

export const isLinearId = (id: string): id is ItemId<"linear"> => {
  const parsed = parseItemId(id);
  return parsed?.kind === linearKind && linearKeyShape.test(parsed.key);
};
export const isProjectKey = (key: string) => key.startsWith("P-");
export const projectId = (slugId: string): ItemId<"linear"> => itemId("linear", `P-${slugId}`);

export const linearPresentation: Presentation = {
  name: "Linear",
  inSentence: "Linear",
  icon: "ticket",
  keysReadAs: null,
  columns: issueColumns,
  details: issueDetails,
};

// Where each status type stands, in core's words.
const categories: Record<StatusType, State> = {
  triage: "todo",
  backlog: "todo",
  unstarted: "todo",
  started: "in-progress",
  completed: "done",
  canceled: "done",
};
// A project's, by its status's type; one Oriel doesn't know is to do.
const projectCategories: Record<string, State> = {
  started: "in-progress",
  paused: "in-progress",
  completed: "done",
  canceled: "done",
};

// What a read gives, an issue's or a project's: its title and text, and
// its fields by name, as the namespace and the panel read them. Source
// content: it reaches the model only in tool results.
export const linearContent = union(
  object({
    kind: literal("issue"),
    title: string,
    text: string,
    key: string,
    description: string,
    status: string,
    team: string,
    project: nullable(object({ id: string, name: string })),
    cycle: nullable(object({ number: number, name: nullable(string) })),
    parent: nullable(string),
    assignee: nullable(string),
    estimate: nullable(number),
    labels: array(string),
    url: string,
    updatedAt: string,
  }),
  object({
    kind: literal("project"),
    title: string,
    text: string,
    key: string,
    description: string,
    status: string,
    lead: nullable(string),
    targetDate: nullable(string),
    url: string,
    updatedAt: string,
  }),
);
export type LinearContent = Infer<typeof linearContent>;
export type IssueContent = Extract<LinearContent, { kind: "issue" }>;

// What a sync knows of the team, beside its issues: each status's type,
// each cycle and each project, by their UUIDs.
export type TeamWorld = {
  team: { id: string; key: string; name: string };
  statuses: readonly LinearStatus[];
  cycles: readonly LinearCycle[];
  projects: readonly LinearProject[];
};

const textOf = (title: string, description: string) =>
  description === "" ? title : `${title}\n\n${description}`;

// A project as the index keeps it: an epic, with no assignee or estimate.
export function projectRecord(project: LinearProject): IndexRecord<"linear", IssueAttrs> {
  const fields: IssueFields = {
    kind: "epic",
    type: "Project",
    status: {
      name: project.status.name || "Planned",
      category: projectCategories[project.status.type] ?? "todo",
    },
    labels: [],
    updatedAt: project.updatedAt as IssueFields["updatedAt"],
  };
  return issueRecord(
    {
      id: projectId(project.slugId),
      stableId: project.id,
      title: project.name,
      location: project.url,
    },
    fields,
  );
}

export function projectContent(project: LinearProject): LinearContent {
  return {
    kind: "project",
    title: project.name,
    text: textOf(project.name, project.description),
    key: `P-${project.slugId}`,
    description: project.description,
    status: project.status.name,
    lead: project.lead,
    targetDate: project.targetDate,
    url: project.url,
    updatedAt: project.updatedAt,
  };
}

// An issue's status's type: the answer's, or its team's status of that
// name's. A status its team doesn't list can't be read.
function statusTypeOf(issue: LinearIssue, world: TeamWorld): StatusType {
  const type =
    issue.statusType ?? world.statuses.find((status) => status.name === issue.status)?.type;
  if (!type) throw new ServerUnreadable(`an issue is in a status its team doesn't list`);
  return type;
}

// An issue as the index keeps it. Its key must be its team's, and its
// project and parent are by their stable IDs, as the sync found them.
export function linearIssueRecord(
  issue: LinearIssue,
  world: TeamWorld,
  byId: ReadonlyMap<string, ItemId>,
): IndexRecord<"linear", IssueAttrs> {
  if (!issueKeyShape.test(issue.identifier) || !issue.identifier.startsWith(`${world.team.key}-`))
    throw new ServerUnreadable(`an issue's identifier isn't its team's`);
  const project = issue.project && world.projects.find((each) => each.id === issue.project);
  const parent = issue.parent ? byId.get(issue.parent) : undefined;
  const fields: IssueFields = {
    kind: issue.parent ? "subtask" : "story",
    type: issue.parent ? "Sub-issue" : "Issue",
    container: project ? { id: projectId(project.slugId), stableId: project.id } : null,
    parent: issue.parent && parent ? { id: parent, stableId: issue.parent } : null,
    status: { name: issue.status, category: categories[statusTypeOf(issue, world)] },
    assignee: issue.assignee,
    estimate: issue.estimate,
    labels: issue.labels,
    updatedAt: issue.updatedAt as IssueFields["updatedAt"],
  };
  return issueRecord(
    {
      id: itemId("linear", issue.identifier),
      stableId: issue.id,
      title: issue.title,
      location: issue.url,
    },
    fields,
  );
}

export function issueContent(
  issue: LinearIssue,
  world: TeamWorld,
  identifiers: ReadonlyMap<string, string>,
): IssueContent {
  const project = issue.project && world.projects.find((each) => each.id === issue.project);
  const cycle = issue.cycle && world.cycles.find((each) => each.id === issue.cycle);
  return {
    kind: "issue",
    title: issue.title,
    text: textOf(issue.title, issue.description),
    key: issue.identifier,
    description: issue.description,
    status: issue.status,
    team: world.team.key,
    project: project ? { id: projectId(project.slugId), name: project.name } : null,
    cycle: cycle ? { number: cycle.number, name: cycle.name } : null,
    parent: issue.parent ? (identifiers.get(issue.parent) ?? null) : null,
    assignee: issue.assignee?.name ?? null,
    estimate: issue.estimate,
    labels: [...issue.labels],
    url: issue.url,
    updatedAt: issue.updatedAt,
  };
}
