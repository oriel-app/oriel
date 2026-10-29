// The zoom levels, hand-built: a cluster as one row (the epic row), opened to
// its items (the story list), and one item (the fullscreen story). Each builds
// the view data the web package renders. None has a summarizer yet: every
// number here is a count or sum over the cluster's items, never generated.
import {
  type Cluster,
  type Instant,
  type ItemId,
  parseItemId,
  type SourceKind,
  type ZoomLevel,
} from "@oriel/core";
import type { ClusterRow, ItemRow, ItemView } from "./view.ts";
import type { JiraRecord } from "./groupings.ts";

const day = 86_400_000;

// What the window calls each source.
const sourceNames: Record<SourceKind, string> = { jira: "Jira" };

// An item ID starts with its source's kind.
function sourceName(id: ItemId): string | undefined {
  const source = parseItemId(id)?.source;
  return source && sourceNames[source];
}

const keyOf = (id: ItemId) => id.slice(id.indexOf(":") + 1);

export function itemRow(record: JiraRecord, now: Instant): ItemRow {
  return {
    id: record.id,
    key: keyOf(record.id),
    title: record.title,
    type: record.attrs.issueType,
    status: record.attrs.status,
    assignee: record.attrs.assignee?.name ?? null,
    points: record.attrs.points,
    idleDays: Math.max(0, Math.floor((Date.parse(now) - Date.parse(record.updatedAt)) / day)),
  };
}

const byId = (records: readonly JiraRecord[]) =>
  new Map<ItemId, JiraRecord>(records.map((record) => [record.id, record]));

// The cluster's records, in its order. An ID the index no longer has is
// skipped, not fatal.
function members(cluster: Cluster, index: ReadonlyMap<ItemId, JiraRecord>): JiraRecord[] {
  return cluster.itemIds.flatMap((id) => index.get(id) ?? []);
}

// The "cluster" zoom level: one row per cluster. A cluster the source has
// names the sources its anchor and items come from.
export function clusterZoom(now: Instant): ZoomLevel<ClusterRow, JiraRecord> {
  return {
    id: "cluster",
    view(cluster, records) {
      const index = byId(records);
      const items = members(cluster, index);
      const anchor = cluster.anchor === null ? undefined : index.get(cluster.anchor);
      const status = { todo: 0, "in-progress": 0, done: 0 };
      for (const item of items) status[item.attrs.status.category] += 1;
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
        points: items.reduce((sum, item) => sum + (item.attrs.points ?? 0), 0),
        unestimated: items.filter((item) => item.attrs.points === null).length,
        status,
      };
    },
  };
}

// The "list" zoom level: a cluster's items, one row each.
export function listZoom(now: Instant): ZoomLevel<ItemRow[], JiraRecord> {
  return {
    id: "list",
    view: (cluster, records) =>
      members(cluster, byId(records)).map((record) => itemRow(record, now)),
  };
}

// The "item" zoom level: each of a cluster's items, as fully as the index has
// it.
export function itemZoom(now: Instant): ZoomLevel<ItemView[], JiraRecord> {
  return {
    id: "item",
    view(cluster, records) {
      const index = byId(records);
      return members(cluster, index).map((record): ItemView => {
        const { epic } = record.attrs;
        return {
          ...itemRow(record, now),
          source: sourceName(record.id) ?? "",
          url: record.url,
          labels: [...record.attrs.labels],
          epic:
            epic === null
              ? null
              : { id: epic, key: keyOf(epic), title: index.get(epic)?.title ?? null },
          updatedAt: record.updatedAt,
        };
      });
    },
  };
}
