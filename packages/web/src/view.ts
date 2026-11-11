// What the server's JSON routes return: plain data the window renders as it
// is. The server builds it with core's `Grouping`, the rows in
// @oriel/groupings and its stores; the browser renders it. Both sides import
// this file, so it imports only types, which the browser build erases.
// Source text (titles, content) is always text here, never HTML.
import type { ChartBlock } from "@oriel/core/block-charts";
import type { ChangeSetState } from "@oriel/core/oriel-reads";
import type { ReviewField, ReviewOutline, ReviewTable } from "@oriel/core/connect";
import type { SignalKind, SignalSubject } from "@oriel/core/noticed";
import type { PanelBlock, PanelEdit } from "@oriel/core/panel";
import type { ClusterRow, ItemRow, StatusCategory } from "@oriel/groupings/view";

export type { ClusterRow, ItemRow, StatusCategory } from "@oriel/groupings/view";
export type { BrowseColumn, ConnectorIcon, ConnectorView } from "@oriel/core/connector-view";
export type {
  ConnectOffer,
  ConnectStep,
  OptionField,
  ReviewEdit,
  ReviewField,
  ReviewOutline,
  ReviewTable,
} from "@oriel/core/connect";
export type {
  PanelBlock,
  PanelEdit,
  PanelEditField,
  PanelInline,
  PanelMessage,
  PanelProse,
} from "@oriel/core/panel";

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

// A connection as the window shows it (decision 0049), every one drawn the
// same way: the ID the page names it by, which the server made; its
// connector's kind; its number, and its prefix, whose its items are; its
// name in the window, the person's (`named`) or its connector's; what it
// reads, as the sidebar says it (a project and its site, a path, a
// workspace), and in a word or two (a project, a directory's name); what it
// identifies in its source and its options, never
// its secret; whether its options make it read-only, and why it's
// read-only whatever they say (`all` when none of it can be written); how
// often it syncs, in minutes, null for when Oriel starts and when asked; how many items the index has
// from it, and when it last synced; why its last sync didn't work, and what
// it left out, a line each; whether it's open, waiting for options that fit
// its source (decision 0051), or shut, as one its source server couldn't
// open; whether a flag of `pnpm dev` makes it, so the
// window can't set or disconnect it; and whether it's a stand-in's.
export type ConnectionView = {
  id: string;
  kind: string;
  number: number;
  prefix: string;
  name: string;
  named: boolean;
  about: string;
  reads: string;
  identity: string;
  options: Record<string, unknown>;
  readOnly: boolean;
  viewOnly: { why: string; all: boolean } | null;
  every: number | null;
  items: number;
  syncedAt: string | null;
  // What its last sync changed: how many items it found new, changed and
  // gone from the source.
  lastSync: { new: number; changed: number; removed: number };
  problem: string | null;
  report: readonly string[];
  state: "open" | "waiting" | "shut";
  flagged: boolean;
  // A stand-in's (decision 0059): Oriel keeps it itself, so the window
  // neither sets, syncs nor disconnects it.
  own: boolean;
  // The source server it reads through, by its name in the person's agent
  // (decision 0059): turned off in Source servers, never disconnected.
  through: string | null;
  // What the person picks on it through that server, as its options keep
  // them: the option, its label, whether several are picked and at most how
  // many, and what it reads with none, in a phrase.
  picks: ConnectionPick[];
};

export type ConnectionPick = {
  name: string;
  label: string;
  many: boolean;
  most: number | null;
  unpicked: string;
  // What it says of a picked value its list doesn't give, if it says.
  unlisted: string | null;
  // The values its options pick now, as its server's pick reads them.
  picked: string[];
};

// Every connection, which kinds the window may connect now and why not the
// others, and whether the server offers the folder picker, for a
// connector's folder step.
export type ConnectionsView = {
  connections: ConnectionView[];
  connectable: string[];
  refused: Readonly<Record<string, string>>;
  picker: boolean;
  // The stand-ins on now, by kind (decision 0059).
  standingIn: string[];
  // What Oriel found in the person's agent, and which kinds are on.
  servers: SourceServersView;
};

// A source server Oriel found in the person's agent (decision 0059): the
// kind it serves, its name in the agent, the name Oriel knows it by, and
// whether its kind is on.
export type FoundServerView = { kind: string; server: string; known: string; on: boolean };

// What Oriel found in the agent picked in Settings, by its name, when it
// last looked, whether it's looking now, and why the last look failed; the
// kinds on now or turned off, each with the server it came through, or
// null for its own connection, and who turned it off; for each kind with a
// server Oriel knows and none found, that server and its vendor's own
// instructions; the overview's card of what changed, until it's dismissed;
// and when sync runs, every so many minutes or null for when Oriel opens
// and when the person presses sync, and whether it spends their plan.
export type SourceServersView = {
  agent: string | null;
  looking: boolean;
  problem: string | null;
  // The last look found no AI to ask: none is picked and runs, so no
  // source server is read until one does.
  noAgent: boolean;
  found: FoundServerView[];
  kinds: {
    kind: string;
    on: boolean;
    server: string | null;
    offBy: "person" | "agent" | null;
    // Why it couldn't open through its server, naming it, until it does.
    problem?: string | null;
  }[];
  missing: { kind: string; server: string; instructions: string }[];
  card: {
    appeared: FoundServerView[];
    gone: { kind: string; server: string; on: boolean }[];
  } | null;
  sync: { every: number | null };
};

// What a connection's review step shows (decision 0051): whether it waits
// for its options; while it does, Oriel's own guess, drawn from its source,
// with the options it settles into; the agent's draft once its onboarding
// turn holds one, drawn, and where it is held; and that turn's thread while
// it runs. Once it reads, `current`: its options as they read now, drawn the
// same way, for Settings to show and change (OA-232). Each carries its draft
// in its connector's own form, `given`, which an edit starts from, and what
// applying it does to the items the connection has, `said`. `fields`: what
// a column can feed.
export type OptionsReviewView = {
  waits: boolean;
  guess: {
    given: Record<string, unknown>;
    tables: ReviewTable[];
    options: Record<string, unknown>;
    said: string[];
  } | null;
  draft: {
    thread: string;
    seq: number;
    given: Record<string, unknown>;
    tables: ReviewTable[];
    said: string[];
  } | null;
  drafting: { thread: string } | null;
  current: { given: Record<string, unknown>; tables: ReviewTable[] } | null;
  fields: readonly ReviewField[];
  // Once it reads, each of its tables in a line, for Settings (OA-232).
  outline: ReviewOutline[] | null;
};

// A review's draft with the person's edits made: in its connector's form,
// drawn, with the options it settles into, or why it doesn't settle, and
// what applying it does to the items the connection has.
export type ReviewRedrawn = {
  given: Record<string, unknown>;
  tables: ReviewTable[];
  options: Record<string, unknown> | null;
  said: string[];
  problem: string | null;
};

// One of a connector's pick step's list, such as a project: what is
// picked, its name, how many items it holds and when it last changed, when
// the source says.
export type PickChoiceView = {
  value: string;
  name: string;
  count: number | null;
  updatedAt: string | null;
  // Picked, but not in the list the server gave, by the name Oriel last
  // knew: it shows so it can be unpicked.
  unlisted?: true;
};

export const threadStates = ["working", "done", "handed-off", "dropped"] as const;
export type ThreadStateId = (typeof threadStates)[number];

// Who a held message is from: a review link's holder, by the name they
// typed, giving why they rejected a change set. Each kind of sender is one
// variant, as the server's HeldSender has them.
export type HeldFrom =
  | { kind: "review-link"; by: string; changeSetId: string }
  // The user's own request, carried on from the window chat by Continue
  // in… (decision 0027).
  | { kind: "window-chat"; chatId: string };

// One of Oriel's lines in a thread, as the server's OrielNote has them:
// a change set of the thread was rejected, here or on its review link, and
// Oriel asks what was wrong with it.
export type NoteView =
  | { kind: "rejected"; changeSetId: string; via: "thread" | "review-link" }
  // The user undid their rejection of it (OA-258).
  | { kind: "unrejected"; changeSetId: string }
  // Oriel's offer to move its stand-in's issues into a kind that turned on
  // (decision 0059).
  | { kind: "moving"; changeSetId: string; from: string; into: string; items: number }
  // That move applied, and the workstreams that hold its items now.
  | { kind: "moved"; changeSetId: string; into: string; workstreams: WorkstreamRef[] };

// A workstream as a line links to it.
export type WorkstreamRef = { id: string; name: string };

// What a working thread waits on: its agent, mid-turn; the user, on a change
// set offering a step besides a revert, which any applied one offers; its
// sources, on a change set being applied, which needs nothing from the user
// until it ends, unless it has stalled (OA-82), when the user should know;
// or else the user's next message. A thread in any other state waits on
// nothing.
export type WaitingOn = "agent" | "held" | "draft" | "review" | "apply" | "stalled" | "reply";

// Whether a thread waiting so waits on the user: a message held for them, a
// change set to review, an apply stalled on its source, or a reply. Needs
// you lists it.
export const waitsOnUser = (waiting: WaitingOn | null): boolean =>
  waiting === "held" ||
  waiting === "draft" ||
  waiting === "review" ||
  waiting === "stalled" ||
  waiting === "reply";

// `held`: a message from anyone but the user waits on them to send it to the
// agent or discard it. `draft`: a draft of the agent's waits on them to apply
// it or discard it (decision 0051).
// Whether a held message in the chat waits on the user.
export const holding = (entries: readonly ChatEntry[]): boolean =>
  entries.some(
    (entry) =>
      (entry.kind === "held" || entry.kind === "draft" || entry.kind === "continue") &&
      entry.outcome === null,
  );

// Whether a change set awaits review: it offers a step besides a revert,
// which any applied one offers.
export const toReview = (set: { nextSteps: readonly { kind: string }[] }): boolean =>
  set.nextSteps.some((step) => step.kind !== "revert");

// A window chat waits on the user only for a held message or a change set:
// an answer to a question asked from the overview isn't the user's turn
// (decision 0027), or every question would add itself to Needs you.
export function waitingOn(thread: {
  state: ThreadStateId;
  running: boolean;
  held?: boolean;
  drafted?: boolean;
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
  if (thread.drafted) return "draft";
  if (thread.changeSets.some(toReview)) return "review";
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
  // The source's name, as its connector declares it, and the item's page
  // there.
  source: string;
  title: string | null;
  url: string | null;
  readAt: string;
  updatedAt: string | null;
  read:
    // `edit`: the form a person edits it in, in place, for a stand-in's
    // item (decision 0059).
    | { status: "ok"; blocks: PanelBlock[]; edit?: PanelEdit }
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

// A workstream's member: its row as a cluster opened shows it, or null when
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
  // The outside tool that made it, by the name the user gave it, and, while
  // it is the workstream's latest version, the call that undoes it
  // (decision 0058).
  tool?: string;
  undo?: UndoView | null;
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
  // While it holds no items, a few to add (OA-348): what its threads'
  // answers named, then the top of Not in a workstream yet.
  suggested?: MemberView[];
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

// Whether each quote from an item in a thread's answers is in that item word
// for word, as Oriel checked it when its turn ended (decision 0032), by its
// item and its text (`quoteKey`). A quote not in it is still being said, or
// went unchecked.
export type Quotes = Readonly<Record<string, boolean>>;

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
// `names`: a label that is an item's ID, as a lane, an epic or a table's
// Item is, by the item's name in the index (decision 0053). `atLeast`: a
// figure that is only a lower bound, which the window marks "≥".
export type BlockView = {
  caption: string;
  more: number;
  outside: boolean;
  names?: Readonly<Record<string, string>>;
} & (
  | { form: "bars"; bars: { label: string; value: number; atLeast?: true }[] }
  | {
      form: "table";
      columns: string[];
      rows: (string | number | boolean | null)[][];
      atLeast?: { row: number; column: number }[];
    }
  | { form: "rows"; items: (MemberView & { inRegion?: true })[] }
  // A waiting connection's preview, read live for the agent to draft its
  // options (decision 0051): its source's cells as text, never items.
  | { form: "preview"; tables: { name: string; columns: string[]; rows: (string | null)[][] }[] }
  // A chart: a series over time, a timeline, a spread or a pivot, every
  // figure in it Oriel's.
  | ChartBlock
);

// Noticed (decision 0052): what Oriel found in the window
// unasked; its subject is core's `SignalSubject`. A card is Oriel's signal, its headline, rule and block Oriel's,
// with one checked line from the model on why it may matter.
export type NoticedSubjectView = SignalSubject;

export type NoticedCardView = {
  signal: string;
  kind: SignalKind;
  subject: NoticedSubjectView;
  headline: string;
  rule: string;
  // The model's line, checked by Oriel; null when it had none that passed.
  why: string | null;
  // Words from one of the signal's items, found there word for word.
  quote: { item: string; text: string } | null;
  block: BlockView | null;
  // Its pin's ID, once pinned.
  pinned: string | null;
};

// A pin (decision 0030): a block's read, rerun on each look with no model.
// Null when its read names nothing there now, as a workstream since deleted.
export type PinView = { id: string; block: BlockView | null };

export type NoticedView = {
  // "running" while a pass is under way, with the last pass's cards that
  // still hold; "quiet" when Oriel found nothing to look at, so no pass ran.
  status: "ready" | "running" | "quiet" | "no-ai" | "failed";
  cards: NoticedCardView[];
  pins: PinView[];
  chips: Chips;
  // When the cards' pass ran, and on which model.
  foundAt: string | null;
  model: string | null;
  // What dismissals taught, in Oriel's words, such as "Shown less: stalled
  // workstreams, after 3 dismissals".
  taught: string[];
  problem: string | null;
};

// A sketch under the agent's reply (decision 0033): the agent's HTML, which
// the page frames from `src` on the sketch origin, in a sandboxed frame
// `height` pixels high. Oriel draws its border and caption.
export type SketchView = { src: string; height: 240 | 400 | 640 };

// One option a draft changes: its name, and its value as it was drafted
// over and as drafted, each as JSON values.
export type DraftChange = { option: string; was: unknown; drafted: unknown };

// What a person's message was about (decision 0062): each item by ID, and
// whether it was outside the thread's region as they sent it.
export type AboutView = { id: string; outside: boolean }[];

export type ChatEntry = { seq: number; at: string } & (
  | { kind: "user"; text: string; about?: AboutView }
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
  | { kind: "sketch"; sketch: SketchView }
  // `revised`: a later turn's revision of a change set an earlier entry
  // shows (OA-309).
  | { kind: "change-set"; changeSetId: string; revised?: true }
  // What Oriel did with the actions the agent asked for, under its reply.
  | { kind: "actions"; lines: ActionLineView[] }
  // A message from anyone but the user, which only they can send to the
  // agent, edited or not. `outcome` is null while it waits on them.
  | { kind: "held"; from: HeldFrom; text: string; outcome: "sent" | "discarded" | null }
  // A draft of the agent's (decision 0051): one of the user's own actions,
  // which only they apply, as it is or edited, or discard. Oriel draws it
  // from its own data: the connection it sets, by name, and each option it
  // changes, as it was drafted over and as drafted. `stale`: the options
  // have moved since, or the connection is gone, so it can't be applied.
  // `outcome` is null while it waits on them.
  | {
      kind: "draft";
      connection: { id: string; name: string } | null;
      changes: DraftChange[];
      // While it waits, the draft as Oriel draws it from its source, for a
      // connector that drafts in its own form, such as columns by letter.
      tables: ReviewTable[] | null;
      // What applying it does to the items the connection has (OA-232).
      said: string[];
      stale: boolean;
      outcome: "applied" | "discarded" | null;
    }
  // A draft of Continue in… (decision 0062): one button that carries the
  // user's request about `item` to a thread on `workstream`, the one that
  // holds it, or a new one named for it when null. Applied, `thread` is
  // where it went on, and `workstream` that thread's.
  | {
      kind: "continue";
      item: ItemRef;
      workstream: string | null;
      thread: string | null;
      outcome: "applied" | "discarded" | null;
    }
  // Oriel's own line about what someone did, never the agent's (OA-91).
  | { kind: "note"; note: NoteView }
  | { kind: "limit"; reason: string }
  // `tryAgain`: the last turn failed with it before the agent did
  // anything, and Try again answers its message again.
  | { kind: "error"; message: string; tryAgain?: true }
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
  // Why it offers no Revert though it applied: a source it wrote to can't
  // take back one of its changes, in one line, as its writer says it, such
  // as a post its source server has no tool to delete. Absent when nothing
  // stops a revert that way.
  cannotUndo?: string;
  createdAt: string;
  // When the agent last revised it in place, replacing its changes (OA-309);
  // null if it never did. Its ID and review link stayed.
  revisedAt: string | null;
  // Oriel's latest second look at it, in the thread only, never on a review
  // link (decision 0054): null while the person hasn't asked for one;
  // absent once it is decided, or where no model runs the agent.
  secondLook?: SecondLookView | null;
};

// A second look: the agent's reading of what else the change set would make
// wrong, each finding on lines of the diff and resting on quotes Oriel
// checked word for word; what it read, from its runs' own records; and what
// changed since. It informs, and never approves or blocks.
export type SecondLookView = {
  id: string;
  state: "running" | "ready" | "failed";
  findings: {
    kind: "conflict" | "discussion" | "companion" | "related";
    lines: number[];
    says: string;
    // A quote from an item (`id`), or of what a line of the diff would
    // write (`line`).
    evidence: (
      | { id: string; line: null; quote: string; outside: boolean }
      | { id: null; line: number; quote: string; outside: false }
    )[];
    // A companion's suggested changes, by their place in `companions`.
    changes: number[];
  }[];
  companions: { place: number; sentence: string; added: boolean }[];
  // The workstream's items it read, of how many, and its searches outside.
  coverage: { read: string[]; of: number; searches: number } | null;
  // What changed since it read the change set: its diff, and the items it
  // rested on that moved.
  stale: { diff: boolean; items: string[] };
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  // The person dismissed it (OA-257): it shows no more until they press
  // Second look again.
  dismissed: boolean;
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
    // The source it writes to, by the name its connector declares.
    source: string;
    applied: boolean;
    // Why apply stopped at this change, in plain words; null otherwise.
    error: string | null;
    // Left unapplied when the rest of a change set that started applying
    // was dismissed.
    dismissed: boolean;
    // Before a decision: why its source won't take it as it stands, or that
    // its source checks it only when it's applied.
    check: { refused: string } | { later: string } | null;
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
  // `items`: while the thread is behind it, how many items the workstream
  // holds now, which the rail's title says.
  workstream: { id: string; name: string; version: number; items?: number };
  state: ThreadStateId;
  doneBy: "applied" | "marked" | null;
  // The workstream version the thread works in, and when it moved there:
  // the thread's last sync with its workstream, or when it opened.
  regionVersion: number;
  syncedAt: string;
  members: MemberView[];
  // Oriel's thread for moving a stand-in's issues into a kind that turned
  // on (decision 0059), whose items go to the workstreams that held the
  // stand-in's, never its own: those that hold them, once it applied, or
  // null before. Absent for any other thread.
  move?: { went: WorkstreamRef[] | null };
  entries: ChatEntry[];
  lastSeq: number;
  running: boolean;
  changeSets: ChangeSetView[];
  // Whether approving can write to any source; when false, change sets can
  // be reviewed and rejected only.
  writable: boolean;
  chips: Chips;
  quotes: Quotes;
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
  // `look`: only its second look changed, so its diff stands (OA-257).
  | { type: "change-set"; changeSetId: string; applying: boolean; look?: true }
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
// Code or Codex, on their subscription. There is no API-key way in (decision
// 0059): `api` is `.env`'s key, under `pnpm dev --agent api` only, and never
// a provider Settings keeps. A provider can have
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
// - ready: installed, signed in, a supported version; or `--agent api`'s key
//   is set;
// - missing, unsupported, signed-out: the CLI isn't there, is a version
//   Oriel can't drive, or has no account;
// - untrusted: from the vendor's installer, but its code signature isn't the
//   vendor's, so Oriel won't run it (decision 0038);
// - checking: Oriel is looking now.
export type ProviderStatus =
  | "ready"
  | "missing"
  | "unsupported"
  | "signed-out"
  | "untrusted"
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
// behind its launch secret, allows.
export type SettingsView = {
  providers: ProviderView[];
  models: ModelOptionView[];
  model: ModelPick | null;
  titleModel: ModelPick | null;
  scripted: boolean;
  cliPaths: boolean;
  theme: string;
  themes: string[];
  textSize: TextSize;
  send: SendKey;
  // Whether the desktop app notifies when a thread newly needs the person,
  // and whether this server can at all.
  notify: boolean;
  notifies: boolean;
  // Whether the desktop app asks before quitting while Oriel works on a
  // thread, and whether this server's app can.
  askBeforeQuitting: boolean;
  asksBeforeQuitting: boolean;
  timeFormat: TimeFormat;
  afterApprove: AfterApprove;
  // How often Oriel reads the person's source servers, in minutes, or null
  // for when it opens and when they press sync (decision 0059).
  sourceSync: number | null;
};

// Today's use of one provider instance, counted by Oriel: thread turns, and
// the tokens its responses read and wrote, titles included (decision 0046).
export type UsageCountsView = { turns: number; inputTokens: number; outputTokens: number };

// One window of the person's plan as their CLI reports it: the five-hour
// session or the week, how much is used, and when it resets.
export type PlanWindowView = {
  kind: "session" | "week";
  usedPercent: number;
  resetsAt: string | null;
};

// A Claude Code or Codex instance's usage, in Settings' Usage:
// Oriel's own counts for today, and the plan's windows, or why there are
// none: no plan limits apply (an API key), the CLI didn't answer, or it
// isn't ready.
export type UsageView = {
  provider: string;
  today: UsageCountsView;
  plan: { windows: PlanWindowView[] } | { none: "no-plan" | "no-answer" | "not-ready" };
};

// Settings' sections, each its own address (OA-181), in the order its list
// shows them: the browser routes them, and the server serves their pages.
export const settingsSections = [
  "providers",
  "usage",
  "connections",
  "general",
  "appearance",
  "asking",
  "notifications",
] as const;
export type SettingsSection = (typeof settingsSections)[number];

// How the window writes a time: "3 min ago", or as a date and time.
export const timeFormats = ["relative", "absolute"] as const;
export type TimeFormat = (typeof timeFormats)[number];

// Where a thread's page goes once the person approves one of its change
// sets: it stays, or goes on to the next thread that needs them.
export const afterApproves = ["stay", "next"] as const;
export type AfterApprove = (typeof afterApproves)[number];

// One change from the settings page, applied at once.
export type SettingsChange =
  | { theme: string }
  | { textSize: TextSize }
  | { send: SendKey }
  | { notify: boolean }
  | { askBeforeQuitting: boolean }
  | { timeFormat: TimeFormat }
  | { afterApprove: AfterApprove }
  | { sourceSync: number | null }
  | { model: ModelPick }
  | { titleModel: ModelPick }
  | { provider: string; on: boolean }
  | { provider: string; path: string | null };

// The person's Claude Code, or their Codex (decision 0048), as the first run
// and Settings show it, on the desktop app (decision 0038): what Oriel
// found, what it's running for them, and what went wrong. Codex has no
// install, update or no-plan state: Oriel only signs it in.
// - checking, missing, signed-out, untrusted, ready: as its provider row;
// - unsupported: a version too old, which an update fixes; too-new: one
//   past what Oriel drives, which Oriel's next update will;
// - installing, signing-in, updating: a command is running;
// - no-plan: signed in on a plan that doesn't include Claude Code.
export type CliState =
  | "checking"
  | "missing"
  | "installing"
  | "unsupported"
  | "too-new"
  | "updating"
  | "signed-out"
  | "signing-in"
  | "no-plan"
  | "untrusted"
  | "ready";
export type CliCommand = "install" | "sign-in" | "update";
export type CliPhase = "downloading" | "setting-up" | "checking" | "waiting" | "updating";

// Why a command or the test turn didn't work, which picks the row's words
// and its way on.
export type CliFailure =
  | "download"
  | "setting-up"
  | "untrusted"
  | "sign-in"
  | "update"
  | "usage-limit"
  | "no-connection"
  | "no-plan"
  | "refused"
  | "other";

export type CliView = {
  state: CliState;
  version: string | null;
  // Once signed in, as `claude auth status` or Codex's `account/read` says:
  // shown, never stored. `personal`: on a personal plan, whose vendor may
  // train on the person's chats; never for an API key.
  account: { plan: string | null; email: string | null; personal: boolean } | null;
  // While a command runs: what it's doing and how long it has run.
  running: { command: CliCommand; phase: CliPhase; ms: number } | null;
  // How a version too old updates: Oriel runs Claude Code's own update, or
  // names the command of the package manager it came from, which Oriel
  // doesn't run.
  update: { by: "oriel" } | { by: "person"; command: string } | null;
  // The last command or test turn that didn't work: the row's sentence, its
  // log for Show details (redacted: no password, key, code, email or link
  // query), and, for a usage limit, when it resets.
  failed: {
    what: CliCommand | "test";
    why: CliFailure;
    sentence: string;
    log: string[];
    resets: string | null;
  } | null;
};

// The first run's own progress (decision 0038). `step`: the first step
// neither done nor skipped, where it opens. `firstRun`: the setup finished
// and no workstream is made yet, while the overview's question to start from
// is the instruction "Make … a workstream". `line`: the overview's one-time
// line shows. `reading`: the first sync of what was connected last, the
// records read of the total its source reports, while it reads, or where it
// stopped.
export type FirstRunView = {
  step: "ai" | "work" | "finished";
  steps: { ai: "done" | "skipped" | null; work: "done" | "skipped" | null };
  firstRun: boolean;
  line: boolean;
  reading: { project: string; read: number; total: number | null; stopped: boolean } | null;
};

// What the desktop app's setup and Settings show: the CLI rows as Settings
// has them (Claude Code, and Codex once installed), each CLI's own state,
// and the first run. Each null under `pnpm dev`, which has neither, and
// `codex` while Codex isn't installed.
export type SetupView = {
  providers: ProviderView[];
  cli: CliView | null;
  codex: CliView | null;
  firstRun: FirstRunView | null;
};
