// What Browse shows of a cluster, hand-built: its row (the epic row), and its
// items, one row each, as it shows them opened (decision 0029). Each builds
// the view data the web package renders. Every number here is a count or sum
// over the cluster's items, never generated.
//
// Facets give what every source shares. What a source calls its items' types
// and states, and its name, come from its presentation, which the composition
// root passes in; a source without one shows what core knows.
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

// What the window calls an item's source: its presentation's name, or its
// kind.
function sourceName(id: ItemId, sources: Presentations): string | undefined {
  return presentationOf(id, sources)?.name ?? parseItemId(id)?.kind;
}

const keyOf = (id: ItemId) => parseItemId(id)?.key ?? id;

// An item's state as a status category, with its source's name for it; none
// for an item whose source tracks no state, which isn't counted as not
// started.
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

// `byId`, built once for the records a builder is handed cluster after
// cluster, and again only when it is handed others.
function lastIndex(): (records: readonly IndexRecord[]) => ReadonlyMap<ItemId, IndexRecord> {
  let last: { records: readonly IndexRecord[]; index: ReadonlyMap<ItemId, IndexRecord> } | null =
    null;
  return (records) => {
    if (last?.records !== records) last = { records, index: byId(records) };
    return last.index;
  };
}

// The cluster's records, in its order. An ID the index no longer has is
// skipped, not fatal.
function members(cluster: Cluster, index: ReadonlyMap<ItemId, IndexRecord>): IndexRecord[] {
  return cluster.itemIds.flatMap((id) => index.get(id) ?? []);
}

// Builds view data from a cluster and the index records it is handed.
export type FromCluster<V> = (cluster: Cluster, records: readonly IndexRecord[]) => V;

// A cluster's row. A cluster the source has names the sources its anchor and
// items come from.
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
      // Only an item whose source estimates can lack an estimate.
      unestimated: items.filter((item) => item.facets.estimate === null).length,
      status,
    };
  };
}

// A cluster's items, one row each, as it shows them opened.
export function clusterItemsOf(now: Instant, sources: Presentations): FromCluster<ItemRow[]> {
  const indexOf = lastIndex();
  return (cluster, records) =>
    members(cluster, indexOf(records)).map((record) => itemRow(record, now, sources));
}
