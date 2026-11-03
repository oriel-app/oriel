// What the server's JSON routes return: plain data the window renders as it
// is. The server builds it with core's `Grouping`, the zoom levels in
// @oriel/groupings and its stores; the browser renders it. Both sides import
// this file, so it imports only types, which the browser build erases.
// Source text (titles, content) is always text here, never HTML.
import type { ChangeSetState } from "@oriel/core/oriel-reads";
import type { PanelBlock } from "@oriel/core/panel";
import type { ClusterRow, ItemRow, StatusCategory } from "@oriel/groupings/view";

export type { ClusterRow, ItemRow, ItemView, StatusCategory } from "@oriel/groupings/view";
export type { PanelBlock, PanelInline, PanelMessage, PanelProse } from "@oriel/core/panel";

export const groupingIds = ["epic", "assignee", "stuck", "linked"] as const;
export type GroupingId = (typeof groupingIds)[number];

export function isGroupingId(value: unknown): value is GroupingId {
  return groupingIds.some((id) => id === value);
}

// A cluster's row, and its items so far. Browse's first reply has none:
// they load when the cluster opens, `pageSize` at a time (decision 0027).
// Under a filter, `matched` is how many of its items match, which are all its
// list holds, and `anchorMatched` is set when its anchor matches too; the row
// still counts them all.
export type ClusterView = {
  row: ClusterRow;
  list: ItemRow[];
  matched?: number;
  anchorMatched?: true;
};

// How many items a cluster's list holds once every page has loaded.
export const listSize = (cluster: ClusterView): number => cluster.matched ?? cluster.row.count;

export const statusCategories = ["todo", "in-progress", "done"] as const;

// Browse's filters (decision 0027), as its address and its requests carry
// them: item search, matched as search() matches, and a source, a status
// category, an assignee, by the person's ID, and whether a workstream holds
// it. Each is absent when unset.
export type BrowseFilter = {
  q?: string;
  source?: string;
  status?: StatusCategory;
  assignee?: string;
  // "none": only items no open workstream holds, all that the overview's
  // Not in a workstream yet ranks its candidates from.
  workstream?: "none";
};

export const filterKeys = ["q", "source", "status", "assignee", "workstream"] as const;

// The filters an address or a request names. A blank one is unset, and so is
// a status that isn't a category; the server checks the rest.
export function browseFilter(params: URLSearchParams): BrowseFilter {
  const filter: BrowseFilter = {};
  for (const key of filterKeys) {
    const value = params.get(key)?.trim();
    if (!value) continue;
    if (key === "status") {
      const status = statusCategories.find((category) => category === value);
      if (status) filter.status = status;
    } else if (key === "workstream") {
      if (value === "none") filter.workstream = value;
    } else filter[key] = value;
  }
  return filter;
}

// The filters as address or request parameters, in one order, the unset left
// out.
export function filterParams(filter: BrowseFilter): [string, string][] {
  return filterKeys.flatMap((key) => {
    const value = filter[key];
    return value ? [[key, value]] : [];
  });
}

export const filtered = (filter: BrowseFilter): boolean => filterParams(filter).length > 0;

// The filters alone, from anything that carries them, as an address does.
export const filterFrom = (from: BrowseFilter): BrowseFilter =>
  browseFilter(new URLSearchParams(filterParams(from)));

export const sameFilter = (a: BrowseFilter, b: BrowseFilter): boolean =>
  `${new URLSearchParams(filterParams(a))}` === `${new URLSearchParams(filterParams(b))}`;

export const pageSize = 50;

// One page of a cluster's items, from the `from`th of the `total` it holds
// now, and where each lives in its source, as `WindowView.locations`. `of`
// names the list it is a page of: it changes when the cluster's items do.
export type ClusterPageView = {
  grouping: GroupingId;
  cluster: string;
  of: string;
  from: number;
  items: ItemRow[];
  total: number;
  locations: Readonly<Record<string, string>>;
};

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
  // What Browse's filters can pick from: the sources the index has items
  // from, and the people assigned an item, by name.
  choices?: { sources: Choice[]; people: Choice[] };
};

export type Choice = { id: string; name: string };

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

// Slack: the workspace whose picked channels the index reads, how many
// conversations it has from them, and when it last synced.
export type SlackView = { workspace: string; items: number; syncedAt: string | null };

// A connected source as the sidebar lists it, every one drawn the same way:
// its kind, its declared name, what of it is connected (Jira's project and
// site, the folder's path, Slack's workspace), how many items the index has
// from it, and when it last synced.
export type SourceView = {
  kind: string;
  name: string;
  about: string;
  items: number;
  syncedAt: string | null;
};

export const threadStates = ["working", "done", "handed-off", "dropped"] as const;
export type ThreadStateId = (typeof threadStates)[number];

// Who a held message is from: a review link's holder, by the name they
// typed, giving why they rejected a change set. Each kind of sender is one
// variant, as the server's HeldSender has them.
export type HeldFrom = { kind: "review-link"; by: string; changeSetId: string };

// One of Oriel's lines in a thread, as the server's OrielNote has them:
// a change set of the thread was rejected, here or on its review link, and
// Oriel asks what was wrong with it.
export type NoteView = {
  kind: "rejected";
  changeSetId: string;
  via: "thread" | "review-link";
};

// What a working thread waits on: its agent, mid-turn; the user, on a change
// set offering a step besides a revert, which any applied one offers; its
// sources, on a change set being applied, which needs nothing from the user
// until it ends, unless it has stalled (OA-82), when the user should know;
// or else the user's next message. A thread in any other state waits on
// nothing.
export type WaitingOn = "agent" | "held" | "review" | "apply" | "stalled" | "reply";

// Whether a thread waiting so waits on the user: a message held for them, a
// change set to review, an apply stalled on its source, or a reply. Needs
// you lists it.
export const waitsOnUser = (waiting: WaitingOn | null): boolean =>
  waiting === "held" || waiting === "review" || waiting === "stalled" || waiting === "reply";

// `held`: a message from anyone but the user waits on them to send it to the
// agent or discard it.
// Whether a held message in the chat waits on the user.
export const holding = (entries: readonly ChatEntry[]): boolean =>
  entries.some((entry) => entry.kind === "held" && entry.outcome === null);

// A window chat waits on the user only for a held message or a change set:
// an answer to a question asked from the overview isn't the user's turn
// (decision 0027), or every question would add itself to Needs you.
export function waitingOn(thread: {
  state: ThreadStateId;
  running: boolean;
  held?: boolean;
  changeSets: readonly {
    status: ChangeSetStatus;
    nextSteps: readonly { kind: string }[];
    stalled?: boolean;
  }[];
  windowChat?: boolean;
}): WaitingOn | null {
  if (thread.state !== "working") return null;
  if (thread.running) return "agent";
  if (thread.held) return "held";
  const open = (set: (typeof thread.changeSets)[number]) =>
    set.nextSteps.some((step) => step.kind !== "revert");
  if (thread.changeSets.some(open)) return "review";
  const applying = thread.changeSets.filter((set) => set.status === "applying");
  if (applying.some((set) => set.stalled)) return "stalled";
  if (applying.length > 0) return "apply";
  return thread.windowChat ? null : "reply";
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

// An item named somewhere: in a workstream, a marker, a search result. `title` is
// null when the index doesn't have the item (deleted, or not synced yet).
// `url` is set only for an http(s) location.
export type ItemRef = { id: string; key: string; title: string | null; url: string | null };

// A workstream's member: its row as the list zoom level shows it, or null when
// the index no longer has the item.
export type MemberView = { ref: ItemRef; row: ItemRow | null };

export type WorkstreamSummary = {
  id: string;
  name: string;
  // Where it came from: a copy of a cluster (its grouping's name for it),
  // items picked by hand, or nothing, for a thread started from nothing or
  // the window chat's first question.
  origin:
    | { kind: "cluster"; grouping: string; label: string | null }
    | { kind: "picked" }
    | { kind: "thread" }
    | { kind: "window" };
  version: number;
  size: number;
  createdAt: string;
  // Its threads, by state.
  threads: Record<ThreadStateId, number>;
  // Once it is done (decision 0028): when it was marked done, and by whom.
  // Null while it is open, as when one of its threads works again.
  done: { at: string; by: "user" | "agent" | "tool" | "other" } | null;
};

// One version of a workstream's membership log, and who made it.
export type WorkstreamChangeView = {
  version: number;
  at: string;
  added: ItemRef[];
  removed: ItemRef[];
  cause: "user" | "agent" | "tool" | "review-link" | "change-set" | "sync";
  // The thread whose agent made it, when the agent did.
  thread?: { id: string; title: string | null };
};

export type ThreadSummaryView = {
  id: string;
  // A few words on what the user first asked, or null before anything was.
  title: string | null;
  workstream: { id: string; name: string };
  state: ThreadStateId;
  doneBy: "applied" | "marked" | null;
  waitingOn: WaitingOn | null;
  activityAt: string;
};

export type WorkstreamView = {
  workstream: WorkstreamSummary;
  members: MemberView[];
  changes: WorkstreamChangeView[];
  threads: ThreadSummaryView[];
};

export type WorkstreamsView = { workstreams: WorkstreamSummary[] };

// A workstream the user deleted: how many threads went with it (decision
// 0028).
export type WorkstreamDeletedView = { threads: number };

// A workstream marked done or reopened, as it is now, and how many of its
// threads that marked done or reopened (decision 0028).
export type WorkstreamEndedView = WorkstreamView & { carried: number };

// One of Oriel's own actions the agent asked for, as the host carried it out
// (decision 0024): what it did, in a sentence that names the workstream or
// thread it touched, or what it didn't do, and why. The model's own reply is
// never the record. `touched` links where it was. `undo` is the call that
// undoes an applied one, or, once the user undid it (`undone`), the one that
// does it again.
export type ActionLineView = {
  text: string;
  applied: boolean;
  undone?: true;
  why: string | null;
  touched: { kind: "workstream" | "thread"; id: string } | null;
  undo: UndoView | null;
};

// The call that undoes one of Oriel's own actions, built by the server from
// what the action changed (decision 0024). The window sends it back as it
// is, to `POST /api/actions/<action>`, which answers with its own undo.
export type UndoView = { action: string; input: unknown };
export type Undoable<T> = T & { undo: UndoView | null };

// Every thread in the workspace.
export type ThreadsView = { threads: ThreadSummaryView[] };

// A chip (decision 0032): what an agent's answer names as `[[id]]`, as Oriel
// draws it in the line, from the index and its own data, never from the
// agent's words. An item, by its source, its key, its title and its status;
// a thread, by its title and where it stands, needing the user among them; a
// change set, by its thread's title and where it stands; a workstream, by its
// name and whether it is done.
export type ChipView =
  | {
      kind: "item";
      source: string;
      key: string;
      name: string;
      url: string | null;
      state: { name: string; category: StatusCategory } | null;
    }
  | { kind: "thread"; name: string; state: ThreadStateId | "needs-you" }
  | { kind: "change-set"; thread: string; name: string; state: ChangeSetState }
  | { kind: "workstream"; name: string; done: boolean };

// The chips a thread's answers name, by ID, as the server resolved them when
// it built the view: null for an ID Oriel can't resolve, which draws as
// "unknown reference". An ID not in it was named since, while the turn ran.
export type Chips = Readonly<Record<string, ChipView | null>>;

// What the sidebar's search found (OA-110): a thread, or one of its change
// sets, with the words around the match. `query` is the query it answers, as
// the server read it.
export type SearchResultView = {
  thread: {
    id: string;
    title: string | null;
    state: ThreadStateId;
    workstream: { id: string; name: string };
  };
  changeSet: { id: string; state: ChangeSetState } | null;
  matched: "name" | "chat" | "change-set";
  excerpt: string;
};
export type SearchView = { query: string; results: SearchResultView[] };

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
// A block under the agent's reply (decision 0030): typed data, never HTML.
// Oriel built it from a read's result, and its caption says which. `more`:
// how many the read had past what it shows.
// `outside`: from a read outside the workstream, the escape hatch, which
// is read-only; a row the workstream holds too says so (`inRegion`).
export type BlockView = { caption: string; more: number; outside: boolean } & (
  | { form: "bars"; bars: { label: string; value: number }[] }
  | { form: "table"; columns: string[]; rows: (string | number | boolean | null)[][] }
  | { form: "rows"; items: (MemberView & { inRegion?: true })[] }
);

export type ChatEntry = { seq: number; at: string } & (
  | { kind: "user"; text: string }
  // `ownAgent`: this thread's agent made every change it covers.
  // `fromLine`: the user made every change it covers by an Undo or Redo
  // under this thread's agent's reply.
  | {
      kind: "marker";
      from: number;
      to: number;
      added: ItemRef[];
      removed: ItemRef[];
      ownAgent?: true;
      fromLine?: true;
    }
  | { kind: "text"; text: string }
  | { kind: "run.started"; runId: string; script: string }
  | { kind: "run.finished"; runId: string; run: RunView }
  // A table, bars or rows of items Oriel built from a read the agent ran,
  // or what a run found outside the workstream (the escape hatch).
  | { kind: "block"; block: BlockView }
  | { kind: "change-set"; changeSetId: string }
  // What Oriel did with the actions the agent asked for, under its reply.
  | { kind: "actions"; lines: ActionLineView[] }
  // A message from anyone but the user, which only they can send to the
  // agent, edited or not. `outcome` is null while it waits on them.
  | { kind: "held"; from: HeldFrom; text: string; outcome: "sent" | "discarded" | null }
  // Oriel's own line about what someone did, never the agent's (OA-91).
  | { kind: "note"; note: NoteView }
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
  // Applying, with no answer to its last send for a send's lease: stuck, as
  // one hung on its source is, until the source answers or the writer gives
  // up, when what can be done with it shows.
  stalled: boolean;
  // A change was sent with no answer, so it may already have been made.
  sentUnapplied: boolean;
  // A source it writes to has no writer here, so it can be reviewed and
  // rejected, not approved. Absent: as the thread's `writable` says.
  readOnly?: boolean;
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
    // The items it names, as its target or a value, that the agent or an
    // outside tool put in the workstream, so an approver can tell (decision
    // 0024).
    brought: { key: string; by: "agent" | "tool" }[];
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
  // The window chat's thread (decision 0027), which the user's turn alone
  // doesn't put in Needs you.
  windowChat?: true;
  workstream: { id: string; name: string; version: number };
  state: ThreadStateId;
  doneBy: "applied" | "marked" | null;
  // The workstream version the thread works in.
  regionVersion: number;
  members: MemberView[];
  entries: ChatEntry[];
  lastSeq: number;
  running: boolean;
  changeSets: ChangeSetView[];
  // Whether approving can write to any source; when false, change sets can
  // be reviewed and rejected only.
  writable: boolean;
  chips: Chips;
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
  // The thread's workstream changed: its name, its members, or what the index has
  // of them, whether or not the thread moved to the new version.
  | { type: "workstream" }
  // An entry already in the thread's chat changed: a held message was sent on
  // or discarded, here or elsewhere.
  | { type: "chat" }
  // The rest of the workspace changed: another thread moved (its turn
  // started or ended, a change set of it changed, or it was opened, marked
  // done or deleted), or one of Oriel's own actions changed a workstream.
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

// A thread just deleted: its workstream, and whether that went with it.
export type DeletedView = { workstreamId: string; workstreamRemoved: boolean };

// What a review link shows, without the thread.
export type ReviewView = { changeSet: ChangeSetView; diff: DiffView };

// Every JSON error reply.
export type ErrorReply = { error: string };

// The overview (decision 0027): the window's first view, of workstreams
// first, then what no workstream holds yet, ranked across sources. Every
// number, list and signal here is computed from the index, the change log
// and Oriel's own data when it is asked for, never by a model; each derived
// one carries its rule. The window chat's `window.overview()` reads the
// same. Source text (titles) is text, never HTML.
export type OverviewView = {
  // The instant it was built for. Day counts count back from it.
  asOf: string;
  // The last change log entry it counts, which leaving the overview marks
  // seen, so an entry that commits after it was built stays unseen.
  seq: number;
  // When the user last left the overview; null before they ever have, when
  // "since" counts every change the log keeps.
  lastSeen: string | null;
  counts: {
    // Items with a change logged since, in a workstream or not.
    changed: number;
    workstreamsMoved: number;
    needsYou: number;
    notInWorkstream: number;
  };
  // What changed since, by workstream, most first, and how much of it no
  // workstream holds.
  changed: { workstreams: { id: string; name: string; moved: number }[]; elsewhere: number };
  needsYou: {
    // The threads waiting on the user, longest waiting first. The page
    // shows the first few until "more" is asked for.
    threads: ThreadSummaryView[];
    // Review links sent that nobody has opened yet, oldest first.
    unopened: UnopenedLinkView[];
  };
  // One computed line each for the standing questions, each with its rule.
  // A question with no answer now, such as "quiet longest" with no
  // workstream, has none.
  headlines: HeadlineView[];
  // Every open workstream, most moved first. The page shows the first few,
  // and any gone quiet, until "more" is asked for.
  workstreams: WorkstreamRowView[];
  // The top candidates, and how many there are in all.
  candidates: { rows: CandidateView[]; total: number };
  people: { rows: PersonRowView[]; total: number };
};

export type UnopenedLinkView = {
  changeSetId: string;
  thread: { id: string; title: string | null };
  workstream: { id: string; name: string };
  sentAt: string;
};

// What a line or a row names: a workstream, a thread, or an item.
export type OverviewRef =
  | { kind: "workstream"; id: string; name: string }
  | { kind: "item"; item: ItemRef };

export type HeadlineView = {
  id: "moved" | "quiet" | "talked" | "top";
  // The question it answers, as its label shows it.
  label: string;
  rule: string;
  subject: OverviewRef;
  // What the measure found, in Oriel's words: "23 items moved, 7 to done".
  detail: string;
};

// A signal a workstream row shows, with its rule.
export type SignalView = { text: string; rule: string };

export type WorkstreamRowView = {
  id: string;
  name: string;
  size: number;
  // Its members by source, by the source's name, most first.
  bySource: { source: string; count: number }[];
  status: Record<StatusCategory, number>;
  // Members with a change logged since the user last looked, and how many of
  // those moved to done; the first few, by item.
  moved: number;
  movedDone: number;
  movedItems: ItemRef[];
  // Changes logged to its members on each of the last 14 days, oldest first.
  activity: number[];
  // Its latest member update or thread activity, and the whole days since;
  // `quiet` once that is as long as an item takes to count as stuck.
  lastActivity: string;
  idleDays: number;
  quiet: boolean;
  threads: { working: number; waiting: number; done: number; dropped: number };
  signals: SignalView[];
};

// One candidate from Not in a workstream yet, ranked across sources: an
// item, or a cluster that Make a workstream copies, with the rule that found
// it and its source's name.
export type CandidateView = {
  subject:
    | { kind: "item"; item: ItemRef }
    | {
        kind: "cluster";
        grouping: GroupingId;
        key: string;
        label: string;
        // The item it is about: the one it hangs off, such as an epic, or
        // for a cluster with none, the item the others name. `size`: how
        // many items Make a workstream would hold, that one included.
        lead: ItemRef | null;
        size: number;
      };
  rule: string;
  source: string;
  weight: number;
  detail: string | null;
  // When its items last changed.
  changedAt: string;
};

export type PersonRowView = {
  id: string;
  name: string;
  inProgress: number;
  // The workstream holding most of their items in progress, if any does.
  top: { id: string; name: string; count: number } | null;
};

// Settings (OA-181), as the person picks them and the server keeps them.
// A provider instance is one way to reach a model: the person's own Claude
// Code or Codex, on their subscription, or an API key. A provider can have
// a second account as another instance of the same kind, with its own ID and
// name. The default model and the Title model are each one provider
// instance and one of its models.
export const providerKinds = ["claude-code", "codex", "api"] as const;
export type ProviderKind = (typeof providerKinds)[number];
export const textSizes = ["small", "default", "large"] as const;
export type TextSize = (typeof textSizes)[number];
// Whether Enter sends a question, Shift+Enter a new line; or Cmd+Enter (or
// Ctrl+Enter) sends, and Enter is a new line.
export const sendKeys = ["enter", "mod-enter"] as const;
export type SendKey = (typeof sendKeys)[number];
export type ModelPick = { provider: string; model: string };

// What Oriel found when it last looked, by instance:
// - ready: installed, signed in, a supported version; or a key is set;
// - missing, unsupported, signed-out: the CLI isn't there, is a version
//   Oriel can't drive, or has no account;
// - no-key: no API key is set;
// - not-yet: installed, but Oriel can't run on it yet;
// - checking: Oriel is looking now.
export type ProviderStatus =
  | "ready"
  | "missing"
  | "unsupported"
  | "signed-out"
  | "no-key"
  | "not-yet"
  | "checking";

// One provider instance's row. `detail` says what was found, in the person's
// words, and never holds a key. `version`: the CLI's, when one answered.
// `path`: where Settings says the CLI is, when it says. `uses`: the models
// it runs now, by name, for threads and for titles; each null when another
// provider runs that.
export type ProviderView = {
  id: string;
  kind: ProviderKind;
  name: string;
  on: boolean;
  status: ProviderStatus;
  detail: string;
  version: string | null;
  path: string | null;
  uses: { model: string | null; title: string | null };
};

export type ModelOptionView = ModelPick & { label: string };

// The settings page. `models`: what the default model and the Title model
// can be, from the providers connected and on. `model` and `titleModel`:
// what runs now, null when nothing can. `scripted`: the server runs the
// scripted agent, as `--agent scripted` asked, so no provider is used.
// `cliPaths`: a CLI's path can be set here, which only the desktop app,
// behind its launch secret, allows. `apiKeys`: an API key can be set here,
// which only the desktop app, keeping it in the OS secret store, allows; the
// page is told only whether one is set, never the key.
export type SettingsView = {
  providers: ProviderView[];
  models: ModelOptionView[];
  model: ModelPick | null;
  titleModel: ModelPick | null;
  scripted: boolean;
  cliPaths: boolean;
  apiKeys: boolean;
  theme: string;
  themes: string[];
  textSize: TextSize;
  send: SendKey;
  // Whether the desktop app notifies when a thread newly needs the person,
  // and whether this server can at all.
  notify: boolean;
  notifies: boolean;
};

// One change from the settings page, applied at once.
export type SettingsChange =
  | { theme: string }
  | { textSize: TextSize }
  | { send: SendKey }
  | { notify: boolean }
  | { model: ModelPick }
  | { titleModel: ModelPick }
  | { provider: string; on: boolean }
  | { provider: string; path: string | null };
