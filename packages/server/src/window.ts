import type { Grouping, IndexRecord, Instant } from "@oriel/core";
import {
  assigneeGrouping,
  clusterZoom,
  epicGrouping,
  listZoom,
  stuckGrouping,
} from "@oriel/groupings";
import type { GroupingId, WindowView } from "@oriel/web/view";

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
    fixture,
  };
}
