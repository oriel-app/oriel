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

type Ref = { id: ItemId; stableId: string };

export type IssueFields = {
  kind: string;
  type: string;
  container?: Ref | null;
  parent?: Ref | null;
  status: { name: string; category: State };
  assignee?: { id: string; name: string } | null;
  // Null: not estimated yet. Absent: the tracker, or the board the issue is on, takes no estimates.
  estimate?: number | null;
  labels?: string[];
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

export type IssueAttrs = { issueType: string; status: string; labels: string[] };

export const issueAttrs = object({
  issueType: string,
  status: string,
  labels: array(string),
}) satisfies Validator<IssueAttrs>;

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

export const issueDetails: DetailsOf = (record) => {
  const attrs = issueAttrs(record.attrs);
  return attrs.ok
    ? { type: attrs.value.issueType, status: attrs.value.status, labels: [...attrs.value.labels] }
    : null;
};

export const issueColumns: readonly BrowseColumn[] = ["assignee", "estimate"];

export const issueDeclaredFacets = {
  estimate: {
    label: "Estimate",
    of: (record) => record.facets.estimate ?? null,
    sums: true,
  },
} satisfies DeclaredFacets;

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
