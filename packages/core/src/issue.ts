// What any issue tracker gives an item (decision 0059): Jira's issues now,
// the stand-in tracker's and Linear's next. Each tracker's connector maps its
// own issues onto this one shape, and Browse's groupings, "stuck", the
// overview's candidates, the panel's facts and the change log read what it
// gives (facets, attrs and a declared estimate), never a tracker's own fields.
// A tracker's extras, such as Jira's sprints, custom fields and its boards'
// estimate field, stay in its own package and its panel.
import type { DeclaredFacets } from "./change-log.ts";
import type { BrowseColumn, DetailsOf } from "./connector-view.ts";
import { type Instant, isInstant, isItemId, type ItemId, type SourceKind } from "./ids.ts";
import {
  type Candidate,
  daysSince,
  type OverviewOf,
  stalled,
  stuckDays,
  thisWeek,
  weights,
} from "./overview.ts";
import type { PanelBlock } from "./panel.ts";
import { type Facets, type IndexRecord, type State, stateShape } from "./source.ts";
import {
  array,
  nullable,
  number,
  object,
  optional,
  refine,
  string,
  type Validator,
} from "./validate.ts";

// Another item, by its handle and its stable ID.
type Ref = { id: ItemId; stableId: string };

// One issue, as its tracker's connector maps it. Each field a tracker may not
// have is optional: absent means it has no such thing, null or empty that it
// has and this issue has none.
export type IssueFields = {
  // What it is in core's words ("epic", "story", "task", "bug", "subtask"),
  // and in the tracker's own ("Story").
  kind: string;
  type: string;
  // Its project or epic, which Browse's epic grouping hangs it off.
  container?: Ref | null;
  // The issue it is part of, such as a sub-task's story. No surface reads
  // it yet, so it isn't indexed.
  parent?: Ref | null;
  // Its status as the tracker names it, and that status's category.
  status: { name: string; category: State };
  assignee?: { id: string; name: string } | null;
  // Null when not estimated yet; absent when the tracker, or the board the
  // issue is on, takes no estimates, so it has none to lack.
  estimate?: number | null;
  labels?: string[];
  // When it last changed.
  updatedAt: Instant;
};

const ref = object({ id: refine(string, isItemId, "expected an item ID"), stableId: string });

export const issueFields = object({
  kind: string,
  type: string,
  container: optional(nullable(ref)),
  parent: optional(nullable(ref)),
  status: object({ name: string, category: stateShape }),
  assignee: optional(nullable(object({ id: string, name: string }))),
  estimate: optional(nullable(number)),
  labels: optional(array(string)),
  updatedAt: refine(string, isInstant, "expected an instant"),
}) satisfies Validator<IssueFields>;

// What the index keeps of an issue beyond core's facets: the tracker's words
// for its type and status, and its labels, for the window.
export type IssueAttrs = { issueType: string; status: string; labels: string[] };

export const issueAttrs = object({
  issueType: string,
  status: string,
  labels: array(string),
}) satisfies Validator<IssueAttrs>;

// An issue as the index keeps it, under its tracker's item ID, stable ID,
// title and location. Its facets carry the assignee (people), the status's
// category (state), the container, the kind and the estimate.
export function issueRecord<K extends SourceKind>(
  item: { id: ItemId<K>; stableId: string; title: string; location: string },
  issue: IssueFields,
): IndexRecord<K, IssueAttrs> {
  return {
    ...item,
    updatedAt: issue.updatedAt,
    facets: issueFacets(issue),
    attrs: { issueType: issue.type, status: issue.status.name, labels: [...(issue.labels ?? [])] },
  };
}

export function issueFacets(issue: IssueFields): Facets {
  const { assignee, container, estimate } = issue;
  return {
    ...(assignee !== undefined && {
      people: assignee ? [{ role: "assignee", id: assignee.id, name: assignee.name }] : [],
    }),
    state: issue.status.category,
    ...(container !== undefined && { container: container && { ...container } }),
    kind: issue.kind,
    ...(estimate !== undefined && { estimate }),
  };
}

// How an issue shows in Browse beyond core's fields: its type, status and
// labels as its tracker names them.
export const issueDetails: DetailsOf = (record) => {
  const attrs = issueAttrs(record.attrs);
  return attrs.ok
    ? { type: attrs.value.issueType, status: attrs.value.status, labels: [...attrs.value.labels] }
    : null;
};

// Browse's columns an issue fills.
export const issueColumns: readonly BrowseColumn[] = ["assignee", "estimate"];

// Its facets beyond the common ones, which the change log records: its
// estimate; null when not estimated yet, or where it takes none.
export const issueDeclaredFacets = {
  estimate: {
    label: "Estimate",
    of: (record) => record.facets.estimate ?? null,
    sums: true,
  },
} satisfies DeclaredFacets;

// An issue tracker's candidates for the overview (decision 0027): an epic no
// workstream holds, as a cluster Make a workstream copies with its items,
// weighted by how many of its open items that no workstream holds changed
// this week; and an issue in progress with no update in `stuckDays`, which
// has stalled.
export const issueOverview: OverviewOf = ({ records, held, now }) => {
  const childrenOf = Map.groupBy(
    records.filter((record) => record.facets.container),
    (record) => record.facets.container?.stableId,
  );
  return records.flatMap((record): Candidate[] => {
    if (held(record)) return [];
    if (record.facets.kind === "epic") return record.facets.state === "done" ? [] : [epic(record)];
    if (!stalled(record, now)) return [];
    return [
      {
        subject: { kind: "item", id: record.id },
        rule: `In progress, no update in ${stuckDays} days`,
        weight: weights.stalled,
        detail: `${daysSince(record.updatedAt, now)} days idle`,
      },
    ];
  });

  function epic(record: IndexRecord): Candidate {
    const changed = (childrenOf.get(record.stableId) ?? []).filter(
      (child) => child.facets.state !== "done" && !held(child) && thisWeek(child.updatedAt, now),
    ).length;
    return {
      subject: { kind: "cluster", grouping: "epic", key: record.stableId },
      rule: "An epic no workstream holds",
      weight: weights.glance + changed * weights.moved,
      ...(changed > 0 && { detail: `${changed} changed this week` }),
    };
  }
};

// The panel's facts about an issue, from a live read: its type, status,
// assignee, estimate and labels, each only where its tracker has it.
export function issueFacts(
  issue: Pick<IssueFields, "type" | "assignee" | "estimate" | "labels"> & {
    status: { name: string; category: State };
  },
): Extract<PanelBlock, { kind: "facts" }> {
  const { assignee, estimate, labels = [] } = issue;
  return {
    kind: "facts",
    facts: [
      { name: "Type", value: issue.type },
      { name: "Status", value: issue.status.name },
      ...(assignee === undefined
        ? []
        : [{ name: "Assignee", value: assignee?.name ?? "Unassigned" }]),
      // Where it takes no estimates, it has none to show, or to lack.
      ...(estimate === undefined
        ? []
        : [
            {
              name: "Estimate",
              value:
                estimate === null
                  ? "Not estimated yet"
                  : `${estimate} ${estimate === 1 ? "point" : "points"}`,
            },
          ]),
      ...(labels.length > 0 ? [{ name: "Labels", value: labels.join(", ") }] : []),
    ],
  };
}
