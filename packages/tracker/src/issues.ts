// Each issue's index row is its source of truth, and what the row lacks is kept beside it; nothing syncs them.
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

// Its number is its stable ID: keys never move or come back.
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

export type IssueKind = "epic" | "story";
const typeNames: Record<IssueKind, string> = { epic: "Epic", story: "Story" };

export type Issue = {
  key: string;
  kind: IssueKind;
  summary: string;
  description: string;
  status: StatusName;
  epic: { id: ItemId<"tracker">; stableId: string } | null;
  assignee: string | null;
  points: number | null;
  labels: string[];
  updatedAt: Instant;
};

export const ownContent = object({ description: string });

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

export const textOf = (issue: Issue) => [issue.summary, issue.description].join("\n\n");

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

// One write at a time to a store, each reading what the one before wrote: a new key must be past every key given,
// and an edit starts from the issue as it is now.
const turns = new WeakMap<OwnItems, Promise<unknown>>();
export function inTurn<T>(own: OwnItems, work: () => Promise<T>): Promise<T> {
  const turn = (turns.get(own) ?? Promise.resolve()).then(work);
  turns.set(
    own,
    turn.catch(() => {}),
  );
  return turn;
}

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
  const nextKey = () =>
    `T-${Math.max(0, ...own.keys().map((key) => Number(stableIdOf(key)) || 0)) + 1}`;
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
