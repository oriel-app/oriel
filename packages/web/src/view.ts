// What the server's JSON routes return: plain data the window renders as it
// is. The server builds it with core's `Grouping`, the zoom levels in
// @oriel/groupings and its stores; the browser renders it. Both sides import
// this file, so it imports only types, which the browser build erases.
// Source text (titles, content) is always text here, never HTML.
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

export const threadStates = ["working", "done", "handed-off", "dropped"] as const;
export type ThreadStateId = (typeof threadStates)[number];

// An item named somewhere: in a group, a marker, a search result. `title` is
// null when the index doesn't have the item (deleted, or not synced yet).
// `url` is set only for an http(s) location.
export type ItemRef = { id: string; key: string; title: string | null; url: string | null };

// A group's member: its row as the list zoom level shows it, or null when
// the index no longer has the item.
export type MemberView = { ref: ItemRef; row: ItemRow | null };

export type GroupSummary = {
  id: string;
  name: string;
  // Where it came from: a copy of a cluster (its grouping's name for it), or
  // items picked by hand.
  origin: { kind: "cluster"; grouping: string; label: string | null } | { kind: "picked" };
  version: number;
  size: number;
  createdAt: string;
  // Its threads, by state.
  threads: Record<ThreadStateId, number>;
};

// One version of a group's membership log.
export type GroupChangeView = {
  version: number;
  at: string;
  added: ItemRef[];
  removed: ItemRef[];
  cause: "user" | "change-set";
};

export type ThreadSummaryView = {
  id: string;
  // The first thing the user asked, or null before anything was.
  title: string | null;
  group: { id: string; name: string };
  state: ThreadStateId;
  doneBy: "applied" | "marked" | null;
  activityAt: string;
};

export type GroupView = {
  group: GroupSummary;
  members: MemberView[];
  changes: GroupChangeView[];
  threads: ThreadSummaryView[];
};

export type GroupsView = { groups: GroupSummary[] };

export type InboxView = { threads: ThreadSummaryView[] };

// A run's record, as its transcript shows it.
export type RunView = {
  outcome: "ok" | "threw" | "timeout" | "limit";
  wallMs: number;
  reads: { fn: string; status: string; outsideRegion: boolean | null }[];
  mutations: number;
  logs: string[];
  // The script's return value as JSON text, or null.
  returned: string | null;
  error: { phase: string; message: string; hint: string | null } | null;
};

// One entry in a thread's chat, in `seq` order. Adjacent text entries are
// one reply streamed in parts; a run's start and finish share its `runId`.
export type ChatEntry = { seq: number; at: string } & (
  | { kind: "user"; text: string }
  | { kind: "marker"; from: number; to: number; added: ItemRef[]; removed: ItemRef[] }
  | { kind: "text"; text: string }
  | { kind: "run.started"; runId: string; script: string }
  | { kind: "run.finished"; runId: string; run: RunView }
  | { kind: "search"; runId: string; hits: (ItemRef & { inRegion: boolean })[] }
  | { kind: "change-set"; changeSetId: string }
  | { kind: "limit"; reason: string }
  | { kind: "error"; message: string }
  | { kind: "done" }
);

// Where a change set stands. "open": awaiting a decision; "stopped":
// approved, and apply stopped before anything landed; "partial": some of it
// applied and something stopped the rest. A stopped change says why.
export type ChangeSetStatus = "open" | "approved" | "stopped" | "rejected" | "applied" | "partial";

export type ChangeSetView = {
  id: string;
  status: ChangeSetStatus;
  // Whether the latest decision approves the change set as it stands. An
  // edit voids it, so the rest needs approving again.
  approved: boolean;
  // A change was sent and may have landed; revert waits until it is applied
  // or removed.
  sentUnapplied: boolean;
  decision: {
    kind: "approved" | "rejected";
    via: "thread" | "review-link";
    by: string;
    at: string;
  } | null;
  // Why the last apply stopped, per mutation.
  errors: { mutationId: string; error: string }[];
  // The change set this one reverts, and those that revert it.
  revertOf: string | null;
  reverts: string[];
  createdAt: string;
};

// One line per mutation, as plain language with the fields it sets. Values
// are display text; null shows as empty.
export type DiffView = {
  changeSetId: string;
  hash: string;
  lines: {
    mutationId: string;
    sentence: string;
    target: ItemRef | null;
    applied: boolean;
    // Why apply stopped at this change, in plain words; null otherwise.
    error: string | null;
    // Whether it can be left out of the change set now.
    removable: boolean;
    fields: { name: string; before: string | null; after: string | null }[];
  }[];
};

export type ThreadView = {
  id: string;
  title: string | null;
  group: { id: string; name: string; version: number };
  state: ThreadStateId;
  doneBy: "applied" | "marked" | null;
  // The group version the thread works in.
  regionVersion: number;
  members: MemberView[];
  entries: ChatEntry[];
  lastSeq: number;
  running: boolean;
  changeSets: ChangeSetView[];
  // Whether approving can write anywhere; when false, change sets can be
  // reviewed and rejected only.
  writable: boolean;
};

// What the thread's event stream sends: a new chat entry, or whether a turn
// is running and the thread's state.
export type StreamEvent =
  | { type: "entry"; entry: ChatEntry }
  | { type: "status"; running: boolean; state: ThreadStateId; regionVersion: number };

// What a review link shows, without the thread.
export type ReviewView = { changeSet: ChangeSetView; diff: DiffView };

// Every JSON error reply.
export type ErrorReply = { error: string };
