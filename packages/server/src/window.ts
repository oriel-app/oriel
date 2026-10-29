import type {
  Cluster,
  Grouping,
  IndexRecord,
  Instant,
  ItemId,
  JiraAttrs,
  ZoomLevel,
} from "@oriel/core";
import type { ClusterRow, GroupingId, ItemRow, WindowView } from "@oriel/web/view";

type JiraRecord = IndexRecord<"jira", JiraAttrs>;

const day = 86_400_000;

export function itemRow(record: JiraRecord, now: Instant): ItemRow {
  return {
    id: record.id,
    key: record.id.slice(record.id.indexOf(":") + 1),
    title: record.title,
    type: record.attrs.issueType,
    status: record.attrs.status,
    assignee: record.attrs.assignee?.name ?? null,
    points: record.attrs.points,
    idleDays: Math.max(0, Math.floor((Date.parse(now) - Date.parse(record.updatedAt)) / day)),
  };
}

// The cluster's records, in its order. An ID the index no longer has is
// skipped, not fatal.
function members(cluster: Cluster, records: readonly JiraRecord[]): JiraRecord[] {
  const byId = new Map<ItemId, JiraRecord>(records.map((record) => [record.id, record]));
  return cluster.itemIds.flatMap((id) => byId.get(id) ?? []);
}

// The "list" zoom level: a cluster's items, one row each.
export function listZoom(now: Instant): ZoomLevel<ItemRow[], JiraRecord> {
  return {
    id: "list",
    view: (cluster, records) => members(cluster, records).map((record) => itemRow(record, now)),
  };
}

// The "cluster" zoom level: one row per cluster. Its numbers are counts and
// sums over the cluster's items, never a generated summary.
export function clusterZoom(now: Instant): ZoomLevel<ClusterRow, JiraRecord> {
  return {
    id: "cluster",
    view(cluster, records) {
      const items = members(cluster, records);
      const anchor = records.find((record) => record.id === cluster.anchor);
      const status = { todo: 0, "in-progress": 0, done: 0 };
      for (const item of items) status[item.attrs.status.category] += 1;
      return {
        key: cluster.key,
        label: cluster.label,
        origin:
          cluster.origin === "source"
            ? { kind: "source", source: "Jira" }
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

export function windowView(
  id: GroupingId,
  grouping: Grouping<JiraRecord>,
  records: readonly JiraRecord[],
  now: Instant,
  sample: boolean,
): WindowView {
  const clusters = grouping.group(records, now);
  const rows = clusterZoom(now);
  const list = listZoom(now);
  const known = new Set(records.map((record) => record.id));
  return {
    grouping: id,
    clusters: clusters.map((cluster) => ({
      row: rows.view(cluster, records),
      list: list.view(cluster, records),
    })),
    items: new Set(clusters.flatMap((cluster) => cluster.itemIds).filter((item) => known.has(item)))
      .size,
    asOf: now,
    sample,
  };
}
