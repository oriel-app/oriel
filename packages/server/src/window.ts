import type { Grouping, IndexRecord, Instant } from "@oriel/core";
import {
  assigneeGrouping,
  clusterZoom,
  epicGrouping,
  listZoom,
  stuckGrouping,
} from "@oriel/groupings";
import { sources } from "@oriel/sources";
import type { GroupingId, WindowView } from "@oriel/web/view";
import { webUrl } from "./views.ts";

export const groupings: Record<GroupingId, Grouping> = {
  epic: epicGrouping,
  assignee: assigneeGrouping,
  stuck: stuckGrouping,
};

export function windowView(
  id: GroupingId,
  grouping: Grouping,
  records: readonly IndexRecord[],
  now: Instant,
  fixture: boolean,
): WindowView {
  const clusters = grouping.group(records, now);
  const rows = clusterZoom(now, sources);
  const list = listZoom(now, sources);
  const known = new Set(records.map((record) => record.id));
  const shown = clusters.map((cluster) => ({
    row: rows.view(cluster, records),
    list: list.view(cluster, records),
  }));
  const ids = new Set(
    shown
      .flatMap(({ row, list }) => [...(row.anchor ? [row.anchor] : []), ...list])
      .map((item) => item.id),
  );
  return {
    grouping: id,
    clusters: shown,
    items: new Set(clusters.flatMap((cluster) => cluster.itemIds).filter((item) => known.has(item)))
      .size,
    asOf: now,
    fixture,
    locations: Object.fromEntries(
      records.flatMap((record) => {
        const url = ids.has(record.id) ? webUrl(record.location) : null;
        return url ? [[record.id, url]] : [];
      }),
    ),
  };
}
