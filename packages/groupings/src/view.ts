// The view data the zoom levels build, for the web package to render. Types
// only, and it imports nothing, so the web package can import it under its
// DOM-only config and the import is erased from the browser build.

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

// One item, as the "item" zoom level shows it: the fullscreen story. It holds
// what the index keeps; the description and comments are read live.
export type ItemView = ItemRow & {
  // The source's name, such as "Jira", and the item's page there.
  source: string;
  url: string;
  labels: string[];
  // `title` is null when the epic isn't in the index.
  epic: { id: string; key: string; title: string | null } | null;
  updatedAt: string;
};

// One cluster, as the "cluster" zoom level shows it: an epic row.
export type ClusterRow = {
  key: string;
  label: string;
  // "source": the source has this structure (a Jira epic), and `source` is its
  // name. "derived": Oriel made it up, and `rule` says how. The window shows
  // which.
  origin: { kind: "source"; source: string } | { kind: "derived"; rule: string };
  // The item the cluster hangs off (the epic), if any.
  anchor: ItemRow | null;
  count: number;
  // Story points of the estimated items, and how many items have none.
  points: number;
  unestimated: number;
  status: Record<StatusCategory, number>;
};
