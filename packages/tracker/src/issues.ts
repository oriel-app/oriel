// The stand-in tracker's issues (decision 0059): Oriel's own small tracker,
// on while no other tracker is connected. Its issues are epics and stories
// in core's issues shape, kept in Oriel's own database: each one's index row
// is its source of truth, and what the row lacks, its description, is kept
// beside it (`OwnItems`). Nothing syncs them.
import {
  array,
  type IndexRecord,
  type Infer,
  type Instant,
  type IssueFields,
  issueAttrs,
  issueRecord,
  type ItemId,
  itemId,
  literal,
  nullable,
  number,
  object,
  type OwnItems,
  type OwnWrite,
  parseItemId,
  type Presentation,
  issueColumns,
  issueDetails,
  type State,
  string,
  union,
} from "@oriel/core";

export const trackerKind = "tracker";

// A key people can read: T-12. Its number is its stable ID, as keys never
// move or come back.
export const trackerKeyShape = /^T-[1-9][0-9]*$/;

export function isTrackerId(id: string): id is ItemId<"tracker"> {
  const parsed = parseItemId(id);
  return parsed?.kind === trackerKind && trackerKeyShape.test(parsed.key);
}

export const trackerPresentation: Presentation = {
  name: "Tracker",
  inSentence: "Oriel's tracker",
  icon: "ticket",
  keysReadAs: null,
  columns: issueColumns,
  details: issueDetails,
};

// Its one workflow: any status may move to any other.
export const statuses = [
  { name: "To do", category: "todo" },
  { name: "In progress", category: "in-progress" },
  { name: "Done", category: "done" },
] as const satisfies readonly { name: string; category: State }[];
export type StatusName = (typeof statuses)[number]["name"];
export const statusNames: readonly string[] = statuses.map((status) => status.name);
export const isStatusName = (name: string): name is StatusName => statusNames.includes(name);
const categoryOf = (name: StatusName) =>
  statuses.find((status) => status.name === name)?.category ?? "todo";

// What it is: an epic, which holds stories, or a story, which an epic may
// hold. An epic takes no estimate.
export type IssueKind = "epic" | "story";
const typeNames: Record<IssueKind, string> = { epic: "Epic", story: "Story" };

// One issue as the tracker has it.
export type Issue = {
  key: string;
  kind: IssueKind;
  summary: string;
  description: string;
  status: StatusName;
  // Its epic, a story's; an epic's is null.
  epic: { id: ItemId<"tracker">; stableId: string } | null;
  // The person it is assigned to, by the name they go by.
  assignee: string | null;
  // Story points; null when not estimated yet. An epic's is null.
  points: number | null;
  labels: string[];
  updatedAt: Instant;
};

// What it keeps beyond its index row (migration 0030).
export const ownContent = object({ description: string });

// Where an issue is: in Oriel itself, which opens it in its panel.
export const locationOf = (key: string) => `/browse?item=${encodeURIComponent(`tracker:${key}`)}`;

export const idOf = (key: string): ItemId<"tracker"> => itemId(trackerKind, key);
export const stableIdOf = (key: string) => key.slice("T-".length);

export function fieldsOf(issue: Issue): IssueFields {
  return {
    kind: issue.kind,
    type: typeNames[issue.kind],
    container: issue.epic && { ...issue.epic },
    parent: null,
    status: { name: issue.status, category: categoryOf(issue.status) },
    assignee: issue.assignee === null ? null : { id: issue.assignee, name: issue.assignee },
    ...(issue.kind === "story" ? { estimate: issue.points } : {}),
    labels: [...issue.labels],
    updatedAt: issue.updatedAt,
  };
}

export const recordOf = (issue: Issue): IndexRecord =>
  issueRecord(
    {
      id: idOf(issue.key),
      stableId: stableIdOf(issue.key),
      title: issue.summary,
      location: locationOf(issue.key),
    },
    fieldsOf(issue),
  );

// What search keeps of it: its summary and description.
export const textOf = (issue: Issue) => [issue.summary, issue.description].join("\n\n");

// An issue from its index row and what it keeps beside it, or null when the
// row isn't one of the tracker's.
export function issueOf(record: IndexRecord, content: unknown): Issue | null {
  const key = parseItemId(record.id)?.key;
  const attrs = issueAttrs(record.attrs);
  const own = ownContent(content);
  const { kind, container, people, estimate } = record.facets;
  if (key === undefined || !attrs.ok || !own.ok || (kind !== "epic" && kind !== "story"))
    return null;
  if (!isStatusName(attrs.value.status)) return null;
  const epic = container && isTrackerId(container.id) ? container : null;
  return {
    key,
    kind,
    summary: record.title,
    description: own.value.description,
    status: attrs.value.status,
    epic: epic && { id: epic.id as ItemId<"tracker">, stableId: epic.stableId },
    assignee: people?.find((person) => person.role === "assignee")?.name ?? null,
    points: kind === "story" ? (estimate ?? null) : null,
    labels: [...attrs.value.labels],
    updatedAt: record.updatedAt,
  };
}

// One write at a time to a store, each reading what the one before wrote:
// a new key must be past every key given, and an edit starts from the
// issue as it is now.
const turns = new WeakMap<OwnItems, Promise<unknown>>();
export function inTurn<T>(own: OwnItems, work: () => Promise<T>): Promise<T> {
  const turn = (turns.get(own) ?? Promise.resolve()).then(work);
  turns.set(
    own,
    turn.catch(() => {}),
  );
  return turn;
}

// The tracker's issues, read from Oriel's own store.
export function issuesIn(own: OwnItems) {
  const all = () =>
    own.records().flatMap((record) => {
      const issue = issueOf(record, own.content(record.stableId));
      return issue ? [issue] : [];
    });
  const byKey = (key: string): Issue | null => {
    const record = own.records().find((each) => each.id === idOf(key));
    return record ? issueOf(record, own.content(record.stableId)) : null;
  };
  // The next key: one past every key its issues have had.
  const nextKey = () =>
    `T-${Math.max(0, ...own.keys().map((key) => Number(stableIdOf(key)) || 0)) + 1}`;
  // Lands issues as they are now, and takes keys away, at once.
  const put = (what: OwnWrite, issues: readonly Issue[], gone: readonly string[] = []) =>
    own.write({
      what,
      records: issues.map(recordOf),
      texts: Object.fromEntries(issues.map((issue) => [stableIdOf(issue.key), textOf(issue)])),
      contents: Object.fromEntries(
        issues.map((issue) => [stableIdOf(issue.key), { description: issue.description }]),
      ),
      gone: gone.map(stableIdOf),
    });
  return { all, byKey, nextKey, put };
}

// What a live read gives of an issue, as its panel and the agent read it.
export const trackerContent = object({
  key: string,
  kind: union(literal("epic"), literal("story")),
  summary: string,
  description: string,
  status: string,
  epic: nullable(string),
  assignee: nullable(string),
  points: nullable(number),
  labels: array(string),
  updatedAt: string,
});
export type TrackerContent = Infer<typeof trackerContent>;

export const contentOf = (issue: Issue): TrackerContent => ({
  key: issue.key,
  kind: issue.kind,
  summary: issue.summary,
  description: issue.description,
  status: issue.status,
  epic: issue.epic?.id ?? null,
  assignee: issue.assignee,
  points: issue.points,
  labels: [...issue.labels],
  updatedAt: issue.updatedAt,
});
