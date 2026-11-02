import { createHash } from "node:crypto";
import type { Cluster, Grouping, IndexRecord, Instant } from "@oriel/core";
import {
  assigneeGrouping,
  clusterZoom,
  epicGrouping,
  listZoom,
  stuckGrouping,
} from "@oriel/groupings";
import { sources } from "@oriel/sources";
import {
  type ClusterPageView,
  type GroupingId,
  type ItemRow,
  pageSize,
  type WindowView,
} from "@oriel/web/view";
import { webUrl } from "./views.ts";

export const groupings: Record<GroupingId, Grouping> = {
  epic: epicGrouping,
  assignee: assigneeGrouping,
  stuck: stuckGrouping,
};

// Where each of `rows` lives in its source, for an http(s) location only.
function locations(rows: readonly ItemRow[], records: readonly IndexRecord[]) {
  const ids = new Set(rows.map((row) => row.id));
  return Object.fromEntries(
    records.flatMap((record) => {
      const url = ids.has(record.id) ? webUrl(record.location) : null;
      return url ? [[record.id, url]] : [];
    }),
  );
}

// The clusters as rows, each with its items as the list zoom level shows
// them, or with none: Browse loads a cluster's items when it opens, a page
// at a time (decision 0027).
function clustersView(
  id: GroupingId,
  clusters: readonly Cluster[],
  records: readonly IndexRecord[],
  now: Instant,
  fixture: boolean,
  withItems: boolean,
): WindowView {
  const rows = clusterZoom(now, sources);
  const list = listZoom(now, sources);
  const known = new Set(records.map((record) => record.id));
  const shown = clusters.map((cluster) => ({
    row: rows.view(cluster, records),
    list: withItems ? list.view(cluster, records) : [],
  }));
  return {
    grouping: id,
    clusters: shown,
    items: new Set(clusters.flatMap((cluster) => cluster.itemIds).filter((item) => known.has(item)))
      .size,
    asOf: now,
    fixture,
    locations: locations(
      shown.flatMap(({ row, list }) => [...(row.anchor ? [row.anchor] : []), ...list]),
      records,
    ),
  };
}

// The whole grouped list in one reply, every cluster with all its items.
export function windowView(
  id: GroupingId,
  grouping: Grouping,
  records: readonly IndexRecord[],
  now: Instant,
  fixture: boolean,
): WindowView {
  return clustersView(id, grouping.group(records, now), records, now, fixture, true);
}

// Browse's first reply: the clusters as rows, with no items yet.
export function browseView(
  id: GroupingId,
  grouping: Grouping,
  records: readonly IndexRecord[],
  now: Instant,
  fixture: boolean,
): WindowView {
  return clustersView(id, grouping.group(records, now), records, now, fixture, false);
}

// One page of a cluster's items, from the `from`th, as the list zoom level
// shows them; null when the grouping has no cluster with that key now.
export function clusterPage(
  id: GroupingId,
  grouping: Grouping,
  records: readonly IndexRecord[],
  now: Instant,
  key: string,
  from: number,
): ClusterPageView | null {
  const cluster = grouping.group(records, now).find((each) => each.key === key);
  if (!cluster) return null;
  const known = new Set(records.map((record) => record.id));
  const present = cluster.itemIds.filter((item) => known.has(item));
  const page = { ...cluster, itemIds: present.slice(from, from + pageSize) };
  const items = listZoom(now, sources).view(page, records);
  return {
    grouping: id,
    cluster: key,
    of: createHash("sha256").update(present.join("\n")).digest("base64url").slice(0, 16),
    from,
    items,
    total: present.length,
    locations: locations(items, records),
  };
}
