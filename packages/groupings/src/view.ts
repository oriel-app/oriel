// The view data Browse's rows are built from, for the web package to render.
// Types only, and it imports nothing, so the web package can import it under its
// DOM-only config and the import is erased from the browser build.

export type StatusCategory = "todo" | "in-progress" | "done";

// One item, as a cluster opened shows it.
export type ItemRow = {
  // Source-qualified (`jira:SYN-12`); `key` is the part people read.
  id: string;
  key: string;
  title: string;
  type: string;
  // Null for an item whose source tracks no state.
  status: { name: string; category: StatusCategory } | null;
  assignee: string | null;
  points: number | null;
  // Set when the item tracks work but its source takes no estimates, as a
  // Jira project whose board has no points field: its null points are no
  // estimate to lack. Absent otherwise.
  noEstimates?: true;
  // Whole days from the item's last update to the window's `asOf`.
  idleDays: number;
  // A chat message's replies, and its link, which opens them. Absent when it
  // has none.
  replies?: { count: number; url: string };
};

// One cluster as its row: an epic row.
export type ClusterRow = {
  key: string;
  label: string;
  // "source": the source has this structure (a Jira epic), and `source` is its
  // name. "derived": Oriel made it up, and `rule` says how. The window shows
  // which.
  origin: { kind: "source"; source: string } | { kind: "derived"; rule: string };
  // The item the cluster hangs off (the epic), if any.
  anchor: ItemRow | null;
  // How many items it lists, its anchor not among them, and how many a
  // workstream made of it holds: those and its anchor.
  count: number;
  size: number;
  // Story points of the estimated items, how many items have an estimate,
  // and how many could have one and don't. An item whose source doesn't
  // estimate is neither.
  points: number;
  estimated: number;
  unestimated: number;
  status: Record<StatusCategory, number>;
};
