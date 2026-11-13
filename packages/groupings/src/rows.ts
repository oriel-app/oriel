// Every number here is a count or sum over the cluster's items, never generated.
import {
  type Cluster,
  clusterMembers,
  type IndexRecord,
  type Instant,
  type ItemId,
  parseItemId,
  type Presentation,
  type Presentations,
} from "@oriel/core";
import { assigneeOf } from "./groupings.ts";
import type { ClusterRow, ItemRow, StatusCategory } from "./view.ts";

const day = 86_400_000;

const presentationOf = (id: ItemId, sources: Presentations): Presentation | undefined => {
  const kind = parseItemId(id)?.kind;
  return kind === undefined ? undefined : sources[kind];
};

function sourceName(id: ItemId, sources: Presentations): string | undefined {
  return presentationOf(id, sources)?.name ?? parseItemId(id)?.kind;
}

const keyOf = (id: ItemId) => parseItemId(id)?.key ?? id;

const statusOf = (record: IndexRecord, name: string): ItemRow["status"] => {
  const category: StatusCategory | undefined = record.facets.state;
  return category === undefined ? null : { name, category };
};

export function itemRow(record: IndexRecord, now: Instant, sources: Presentations): ItemRow {
  const details = presentationOf(record.id, sources)?.details(record) ?? null;
  return {
    id: record.id,
    key: keyOf(record.id),
    title: record.title,
    type: details?.type ?? record.facets.kind ?? "",
    status: statusOf(record, details?.status ?? ""),
    assignee: assigneeOf(record)?.name ?? null,
    points: record.facets.estimate ?? null,
    ...(record.facets.state !== undefined && record.facets.estimate === undefined
      ? { noEstimates: true as const }
      : {}),
    idleDays: Math.max(0, Math.floor((Date.parse(now) - Date.parse(record.updatedAt)) / day)),
    ...(details?.replies ? { replies: { count: details.replies, url: record.location } } : {}),
  };
}

const byId = (records: readonly IndexRecord[]) =>
  new Map<ItemId, IndexRecord>(records.map((record) => [record.id, record]));

function lastIndex(): (records: readonly IndexRecord[]) => ReadonlyMap<ItemId, IndexRecord> {
  let last: { records: readonly IndexRecord[]; index: ReadonlyMap<ItemId, IndexRecord> } | null =
    null;
  return (records) => {
    if (last?.records !== records) last = { records, index: byId(records) };
    return last.index;
  };
}

function members(cluster: Cluster, index: ReadonlyMap<ItemId, IndexRecord>): IndexRecord[] {
  return cluster.itemIds.flatMap((id) => index.get(id) ?? []);
}

export type FromCluster<V> = (cluster: Cluster, records: readonly IndexRecord[]) => V;

export function clusterRowOf(now: Instant, sources: Presentations): FromCluster<ClusterRow> {
  const indexOf = lastIndex();
  return (cluster, records) => {
    const index = indexOf(records);
    const items = members(cluster, index);
    const anchor = cluster.anchor === null ? undefined : index.get(cluster.anchor);
    const status = { todo: 0, "in-progress": 0, done: 0 };
    for (const item of items) if (item.facets.state) status[item.facets.state] += 1;
    const ids = clusterMembers(cluster);
    const names = new Set(ids.flatMap((id) => sourceName(id, sources) ?? []));
    return {
      key: cluster.key,
      label: cluster.label,
      origin:
        cluster.origin === "source"
          ? { kind: "source", source: [...names].join(" and ") }
          : { kind: "derived", rule: cluster.origin.derived },
      anchor: anchor ? itemRow(anchor, now, sources) : null,
      count: items.length,
      size: ids.filter((id) => index.has(id)).length,
      points: items.reduce((sum, item) => sum + (item.facets.estimate ?? 0), 0),
      estimated: items.filter((item) => typeof item.facets.estimate === "number").length,
      unestimated: items.filter((item) => item.facets.estimate === null).length,
      status,
    };
  };
}

export function clusterItemsOf(now: Instant, sources: Presentations): FromCluster<ItemRow[]> {
  const indexOf = lastIndex();
  return (cluster, records) =>
    members(cluster, indexOf(records)).map((record) => itemRow(record, now, sources));
}
