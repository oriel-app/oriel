// The zoom levels, hand-built: a cluster as one row (the epic row), opened to
// its items (the story list), and one item (the fullscreen story). Each builds
// the view data the web package renders. None has a summarizer yet: every
// number here is a count or sum over the cluster's items, never generated.
//
// Facets give what every source shares. What a source calls its items' types
// and states, and its name, come from its presentation, which the composition
// root passes in; a source without one shows what core knows.
import {
  type Cluster,
  type IndexRecord,
  type Instant,
  type ItemId,
  parseItemId,
  type Presentation,
  type Presentations,
  type ZoomLevel,
} from "@oriel/core";
import { assigneeOf } from "./groupings.ts";
import type { ClusterRow, ItemRow, ItemView, StatusCategory } from "./view.ts";

const day = 86_400_000;

const presentationOf = (id: ItemId, sources: Presentations): Presentation | undefined => {
  const source = parseItemId(id)?.source;
  return source && sources[source];
};

// What the window calls an item's source: its presentation's name, or its
// kind.
function sourceName(id: ItemId, sources: Presentations): string | undefined {
  return presentationOf(id, sources)?.name ?? parseItemId(id)?.source;
}

const keyOf = (id: ItemId) => id.slice(id.indexOf(":") + 1);

// An item by its source and stable ID, which outlive its handle.
const identity = (item: { id: ItemId; stableId: string }) =>
  `${parseItemId(item.id)?.source ?? ""}\u0000${item.stableId}`;

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
    idleDays: Math.max(0, Math.floor((Date.parse(now) - Date.parse(record.updatedAt)) / day)),
    ...(details?.replies ? { replies: { count: details.replies, url: record.location } } : {}),
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
export function clusterZoom(now: Instant, sources: Presentations): ZoomLevel<ClusterRow> {
  return {
    id: "cluster",
    view(cluster, records) {
      const index = byId(records);
      const items = members(cluster, index);
      const anchor = cluster.anchor === null ? undefined : index.get(cluster.anchor);
      const status = { todo: 0, "in-progress": 0, done: 0 };
      for (const item of items) if (item.facets.state) status[item.facets.state] += 1;
      const ids = cluster.anchor === null ? cluster.itemIds : [cluster.anchor, ...cluster.itemIds];
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
        points: items.reduce((sum, item) => sum + (item.facets.estimate ?? 0), 0),
        estimated: items.filter((item) => typeof item.facets.estimate === "number").length,
        // Only an item whose source estimates can lack an estimate.
        unestimated: items.filter((item) => item.facets.estimate === null).length,
        status,
      };
    },
  };
}

// The "list" zoom level: a cluster's items, one row each.
export function listZoom(now: Instant, sources: Presentations): ZoomLevel<ItemRow[]> {
  return {
    id: "list",
    view: (cluster, records) =>
      members(cluster, byId(records)).map((record) => itemRow(record, now, sources)),
  };
}

// The "item" zoom level: each of a cluster's items, as fully as the index has
// it.
export function itemZoom(now: Instant, sources: Presentations): ZoomLevel<ItemView[]> {
  return {
    id: "item",
    view(cluster, records) {
      const index = byId(records);
      const byIdentity = new Map(records.map((record) => [identity(record), record]));
      return members(cluster, index).map((record): ItemView => {
        const epic = record.facets.container ?? null;
        const parent = epic && byIdentity.get(identity(epic));
        return {
          ...itemRow(record, now, sources),
          source: sourceName(record.id, sources) ?? "",
          url: record.location,
          labels: presentationOf(record.id, sources)?.details(record)?.labels ?? [],
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
