// What `GET /api/window` returns: plain data the window renders as it is. The
// server builds it with core's `Grouping` and the zoom levels in
// @oriel/groupings; the browser renders it. Both sides import this file, so it
// imports only types, which the browser build erases.
import type { ClusterRow, ItemRow } from "@oriel/groupings/view";

export type { ClusterRow, ItemRow, ItemView, StatusCategory } from "@oriel/groupings/view";

export const groupingIds = ["epic", "assignee", "stuck"] as const;
export type GroupingId = (typeof groupingIds)[number];

export function isGroupingId(value: unknown): value is GroupingId {
  return groupingIds.some((id) => id === value);
}

export type ClusterView = { row: ClusterRow; list: ItemRow[] };

export type WindowView = {
  grouping: GroupingId;
  clusters: ClusterView[];
  // Distinct items across clusters; a derived grouping may show one item twice.
  items: number;
  // The instant the window was built for. Derived rules count days back from it.
  asOf: string;
  // True while the server shows the synthetic fixtures instead of the index.
  fixture: boolean;
};
