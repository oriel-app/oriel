// What the server's JSON routes return: plain data the window renders as it
// is. The server builds it with core's `Grouping`, the zoom levels in
// @oriel/groupings and its stores; the browser renders it. Both sides import
// this file, so it imports only types, which the browser build erases.
// Source text (titles, content) is always text here, never HTML.
import type { PanelBlock } from "@oriel/core/panel";
import type { ClusterRow, ItemRow } from "@oriel/groupings/view";

export type { ClusterRow, ItemRow, ItemView, StatusCategory } from "@oriel/groupings/view";
export type { PanelBlock } from "@oriel/core/panel";

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
  // Where each item shown lives in its source, by ID, for an http(s)
  // location only: where a Cmd/Ctrl or middle click on its row goes.
  locations?: Readonly<Record<string, string>>;
};

// The folder of markdown files the user connected, read-only: its real path,
// how many files the index has from it, and when it last synced.
export type FolderView = { path: string; items: number; syncedAt: string | null };

// Jira: the site and project the index syncs, if any, with how many items
// it has from them and when it last synced; and whether the user can
// connect it from the window, which they can only while it isn't connected
// and the server doesn't set it up itself.
export type JiraView = {
  connected: { site: string; project: string; items: number; syncedAt: string | null } | null;
  connectable: boolean;
};

export const threadStates = ["working", "done", "handed-off", "dropped"] as const;
export type ThreadStateId = (typeof threadStates)[number];

// What a working thread waits on: its agent, mid-turn; the user, on a change
// set offering a step besides a revert, which any applied one offers; its
// sources, on a change set being applied, which needs nothing from the user
// until it ends; or else the user's next message. A thread in any other state
// waits on nothing.
export type WaitingOn = "agent" | "review" | "apply" | "reply";

export function waitingOn(thread: {
  state: ThreadStateId;
  running: boolean;
  changeSets: readonly { status: ChangeSetStatus; nextSteps: readonly { kind: string }[] }[];
}): WaitingOn | null {
  if (thread.state !== "working") return null;
  if (thread.running) return "agent";
  const open = (set: (typeof thread.changeSets)[number]) =>
    set.nextSteps.some((step) => step.kind !== "revert");
  if (thread.changeSets.some(open)) return "review";
  return thread.changeSets.some((set) => set.status === "applying") ? "apply" : "reply";
}

// One item in the panel beside the page, read live through the reader the
// agent's `items.read` uses, in its source's own view (`blocks`). `title` is
// the read's, or the index's when the read has none, or null when neither
// has one. `readAt` is when Oriel read it; `updatedAt` when the index last
// saw it change, null for an item the index doesn't have. Source content is
// text, never HTML.
export type ItemPanelView = {
  id: string;
  key: string;
  // The source's name, such as "Jira", and the item's page there.
  source: string;
  title: string | null;
  url: string | null;
  readAt: string;
  updatedAt: string | null;
  read:
    | { status: "ok"; blocks: PanelBlock[] }
    | { status: "moved"; to: ItemRef }
    | { status: "gone"; reason: "deleted" | "forbidden" }
    // The source returned it in a shape its view can't read.
    | { status: "unreadable" };
};

// When the index last saw an item change, without reading its source: how
// an open panel learns that its read has fallen behind.
export type ItemStampView = { id: string; updatedAt: string | null };

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
  // Where it came from: a copy of a cluster (its grouping's name for it),
  // items picked by hand, or nothing, for a thread started from nothing.
  origin:
    | { kind: "cluster"; grouping: string; label: string | null }
    | { kind: "picked" }
    | { kind: "thread" };
  version: number;
  size: number;
  createdAt: string;
  // Its threads, by state.
  threads: Record<ThreadStateId, number>;
};

// One version of a group's membership log, and who made it.
export type GroupChangeView = {
  version: number;
  at: string;
  added: ItemRef[];
  removed: ItemRef[];
  cause: "user" | "agent" | "tool" | "review-link" | "change-set";
};

export type ThreadSummaryView = {
  id: string;
  // A few words on what the user first asked, or null before anything was.
  title: string | null;
  group: { id: string; name: string };
  state: ThreadStateId;
  doneBy: "applied" | "marked" | null;
  waitingOn: WaitingOn | null;
  activityAt: string;
};

export type GroupView = {
  group: GroupSummary;
  members: MemberView[];
  changes: GroupChangeView[];
  threads: ThreadSummaryView[];
};

export type GroupsView = { groups: GroupSummary[] };

// The call that undoes one of Oriel's own actions, built by the server from
// what the action changed (decision 0024). The window sends it back as it
// is, to `POST /api/actions/<action>`, which answers with its own undo.
export type UndoView = { action: string; input: unknown };
export type Undoable<T> = T & { undo: UndoView | null };

export type ThreadsView = { threads: ThreadSummaryView[] };

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
export type ChangeSetStatus =
  | "open"
  | "approved"
  | "stopped"
  | "rejected"
  | "applied"
  | "partial"
  // Being applied now: nothing else can be done with it until that ends.
  | "applying";

// What a person can do with a change set now, as the change set engine says
// (`nextSteps`). The window offers these and nothing else.
export type NextStepView =
  | { kind: "approve" }
  | { kind: "approve-rest" }
  | { kind: "reject" }
  | { kind: "remove"; mutationIds: string[] }
  | { kind: "retry" }
  | { kind: "revert" }
  | { kind: "dismiss"; warnings: string[] };

export type ChangeSetView = {
  id: string;
  status: ChangeSetStatus;
  // Empty while it is being applied: then nothing else can be done with it.
  nextSteps: NextStepView[];
  applying: boolean;
  // A change was sent with no answer, so it may already have been made.
  sentUnapplied: boolean;
  decision: {
    kind: "approved" | "rejected";
    via: "thread" | "review-link";
    by: string;
    at: string;
  } | null;
  // Why the last apply stopped, per mutation.
  // `sent`: it went out with no answer, so it may have been made.
  errors: { mutationId: string; error: string; sent: boolean }[];
  // The change set this one reverts, and those that revert it.
  revertOf: string | null;
  reverts: string[];
  createdAt: string;
};

// An item a field's value names, such as a story's epic: its title as the
// change set leaves it, and its key and link once it exists. `created`: a
// line above creates it.
export type ItemValue = {
  title: string | null;
  key: string | null;
  url: string | null;
  created: boolean;
};

// One line per mutation, as plain language with the fields it sets. Values
// are display text; null is empty.
export type DiffView = {
  changeSetId: string;
  hash: string;
  lines: {
    mutationId: string;
    sentence: string;
    target: ItemRef | null;
    // What it does to its item: makes it, changes some fields, or deletes it.
    kind: "create" | "change" | "delete";
    // What a create makes ("story"); null otherwise.
    makes: string | null;
    applied: boolean;
    // Why apply stopped at this change, in plain words; null otherwise.
    error: string | null;
    // `items`: on a field whose values name items, those items.
    fields: {
      name: string;
      before: string | null;
      after: string | null;
      items?: { before: ItemValue | null; after: ItemValue | null };
    }[];
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
  | {
      type: "status";
      running: boolean;
      state: ThreadStateId;
      regionVersion: number;
      // The thread's title, which the model may write after the first
      // message arrives; absent, the title is as it was.
      title?: string | null;
    }
  // A change set of the thread changed outside this page: it started applying
  // (`applying`), or stopped, or a review link dismissed it.
  | { type: "change-set"; changeSetId: string; applying: boolean }
  // The rest of the workspace changed: another thread moved (its turn
  // started or ended, a change set of it changed, or it was opened, marked
  // done or deleted), or one of Oriel's own actions changed a group.
  | { type: "threads" }
  // This thread was deleted; the stream ends.
  | { type: "deleted" };

// What deleting a thread would lose: the changes its change sets made in
// their sources (by source kind) that still stand, which stay there but can
// no longer be reverted from Oriel; those a revert undid; and those sent
// with no answer, which may have been made. All zero: nothing it did
// reached a source.
export type DeletionView = {
  applied: number;
  reverted: number;
  unconfirmed: number;
  sources: string[];
};

// A thread just deleted: its group, and whether that went with it.
export type DeletedView = { groupId: string; groupRemoved: boolean };

// What a review link shows, without the thread.
export type ReviewView = { changeSet: ChangeSetView; diff: DiffView };

// Every JSON error reply.
export type ErrorReply = { error: string };
