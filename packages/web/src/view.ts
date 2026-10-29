// What `GET /api/window` returns: plain data the window renders as it is. The
// server builds it with core's `Grouping` and `ZoomLevel`; the browser renders
// it. Both sides import this file, so it imports nothing.

export const groupingIds = ["epic", "assignee", "stuck"] as const;
export type GroupingId = (typeof groupingIds)[number];

export function isGroupingId(value: unknown): value is GroupingId {
  return groupingIds.some((id) => id === value);
}

export type StatusCategory = "todo" | "in-progress" | "done";

// One item, as the "list" zoom level shows it.
export type ItemRow = {
  // Source-qualified (`jira:SYN-12`); `key` is the part people read.
  id: string;
  key: string;
  title: string;
  type: string;
  status: { name: string; category: StatusCategory };
  assignee: string | null;
  points: number | null;
  // Whole days from the item's last update to the window's `asOf`.
  idleDays: number;
};

// One cluster, as the "cluster" zoom level shows it: an epic row.
export type ClusterRow = {
  key: string;
  label: string;
  // "source": the source has this structure (a Jira epic). "derived": Oriel
  // made it up, and `rule` says how. The window shows which.
  origin: { kind: "source"; source: string } | { kind: "derived"; rule: string };
  // The item the cluster hangs off (the epic), if any.
  anchor: ItemRow | null;
  count: number;
  // Story points of the estimated items, and how many items have none.
  points: number;
  unestimated: number;
  status: Record<StatusCategory, number>;
};

export type ClusterView = { row: ClusterRow; list: ItemRow[] };

export type WindowView = {
  grouping: GroupingId;
  clusters: ClusterView[];
  // Distinct items across clusters; a derived grouping may show one item twice.
  items: number;
  // The instant the window was built for. Derived rules count days back from it.
  asOf: string;
  // True while the server shows a hand-written sample instead of the index.
  sample: boolean;
};
