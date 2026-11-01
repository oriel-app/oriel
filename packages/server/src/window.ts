import type { Grouping, IndexRecord, Instant, Presentations } from "@oriel/core";
import {
  assigneeGrouping,
  clusterZoom,
  epicGrouping,
  listZoom,
  stuckGrouping,
} from "@oriel/groupings";
import { folderPresentation } from "@oriel/folder";
import { jiraPresentation } from "@oriel/jira";
import { slackPresentation } from "@oriel/slack";
import type { GroupingId, WindowView } from "@oriel/web/view";

// How each connected source shows in the window. The server is where the
// adapters' declarations meet the packages that use them.
export const presentations: Presentations = {
  jira: jiraPresentation,
  folder: folderPresentation,
  slack: slackPresentation,
};

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
  const rows = clusterZoom(now, presentations);
  const list = listZoom(now, presentations);
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
