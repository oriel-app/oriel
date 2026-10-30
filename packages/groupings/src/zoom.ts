// The zoom levels, hand-built: a cluster as one row (the epic row), opened to
// its items (the story list), and one item (the fullscreen story). Each builds
// the view data the web package renders. None has a summarizer yet: every
// number here is a count or sum over the cluster's items, never generated.
import {
  type Cluster,
  type IndexRecord,
  type Instant,
  type ItemId,
  parseItemId,
  type SourceKind,
  type ZoomLevel,
} from "@oriel/core";
import { jiraAttrsOf } from "@oriel/jira";
import { assigneeOf } from "./groupings.ts";
import type { ClusterRow, ItemRow, ItemView, StatusCategory } from "./view.ts";

const day = 86_400_000;

// What the window calls each source.
const sourceNames: Record<SourceKind, string> = { jira: "Jira", folder: "Folder" };

// An item ID starts with its source's kind.
function sourceName(id: ItemId): string | undefined {
  const source = parseItemId(id)?.source;
  return source && sourceNames[source];
}

const keyOf = (id: ItemId) => id.slice(id.indexOf(":") + 1);

// An item by its source and stable ID, which outlive its handle.
const identity = (item: { id: ItemId; stableId: string }) =>
  `${parseItemId(item.id)?.source ?? ""}\u0000${item.stableId}`;

// An item's state, as a status category; an item whose source tracks no state
// counts as not started.
const categoryOf = (record: IndexRecord): StatusCategory => record.facets.state ?? "todo";

// Jira's own fields where the item is Jira's; other sources have no type,
// status name or estimate.
export function itemRow(record: IndexRecord, now: Instant): ItemRow {
  const jira = jiraAttrsOf(record);
  return {
    id: record.id,
    key: keyOf(record.id),
    title: record.title,
    type: jira?.issueType ?? "",
    status: { name: jira?.status ?? "", category: categoryOf(record) },
    assignee: assigneeOf(record)?.name ?? null,
    points: jira?.points ?? null,
    idleDays: Math.max(0, Math.floor((Date.parse(now) - Date.parse(record.updatedAt)) / day)),
  };
}

const byId = (records: readonly IndexRecord[]) =>
  new Map<ItemId, IndexRecord>(records.map((record) => [record.id, record]));

// The cluster's records, in its order. An ID the index no longer has is
// skipped, not fatal.
function members(cluster: Cluster, index: ReadonlyMap<ItemId, IndexRecord>): IndexRecord[] {
  return cluster.itemIds.flatMap((id) => index.get(id) ?? []);
}

// The "cluster" zoom level: one row per cluster. A cluster the source has
// names the sources its anchor and items come from.
export function clusterZoom(now: Instant): ZoomLevel<ClusterRow> {
  return {
    id: "cluster",
    view(cluster, records) {
      const index = byId(records);
      const items = members(cluster, index);
      const anchor = cluster.anchor === null ? undefined : index.get(cluster.anchor);
      const status = { todo: 0, "in-progress": 0, done: 0 };
      for (const item of items) status[categoryOf(item)] += 1;
      const ids = cluster.anchor === null ? cluster.itemIds : [cluster.anchor, ...cluster.itemIds];
      const sources = new Set(ids.flatMap((id) => sourceName(id) ?? []));
      return {
        key: cluster.key,
        label: cluster.label,
        origin:
          cluster.origin === "source"
            ? { kind: "source", source: [...sources].join(" and ") }
            : { kind: "derived", rule: cluster.origin.derived },
        anchor: anchor ? itemRow(anchor, now) : null,
        count: items.length,
        points: items.reduce((sum, item) => sum + (jiraAttrsOf(item)?.points ?? 0), 0),
        // Only a Jira item can be estimated, so only a Jira item can lack one.
        unestimated: items.filter((item) => jiraAttrsOf(item)?.points === null).length,
        status,
      };
    },
  };
}

// The "list" zoom level: a cluster's items, one row each.
export function listZoom(now: Instant): ZoomLevel<ItemRow[]> {
  return {
    id: "list",
    view: (cluster, records) =>
      members(cluster, byId(records)).map((record) => itemRow(record, now)),
  };
}

// The "item" zoom level: each of a cluster's items, as fully as the index has
// it.
export function itemZoom(now: Instant): ZoomLevel<ItemView[]> {
  return {
    id: "item",
    view(cluster, records) {
      const index = byId(records);
      const byIdentity = new Map(records.map((record) => [identity(record), record]));
      return members(cluster, index).map((record): ItemView => {
        const epic = record.facets.container ?? null;
        const parent = epic && byIdentity.get(identity(epic));
        return {
          ...itemRow(record, now),
          source: sourceName(record.id) ?? "",
          url: record.location,
          labels: [...(jiraAttrsOf(record)?.labels ?? [])],
          epic:
            epic === null
              ? null
              : { id: epic.id, key: keyOf(epic.id), title: parent?.title ?? null },
          updatedAt: record.updatedAt,
        };
      });
    },
  };
}
