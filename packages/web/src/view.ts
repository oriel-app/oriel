// Both sides import this file, so it imports only types, which the browser build erases.
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

export type ClusterView = {
  row: ClusterRow;
  list: ItemRow[];
  matched?: number;
  anchorMatched?: true;
};

export const listSize = (cluster: ClusterView): number => cluster.matched ?? cluster.row.count;

export const statusCategories = ["todo", "in-progress", "done"] as const;

export type BrowseFilter = {
  q?: string;
  source?: string;
  status?: StatusCategory;
  assignee?: string;
  workstream?: "none";
};

export const filterKeys = ["q", "source", "status", "assignee", "workstream"] as const;

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

export function filterParams(filter: BrowseFilter): [string, string][] {
  return filterKeys.flatMap((key) => {
    const value = filter[key];
    return value ? [[key, value]] : [];
  });
}

export const filtered = (filter: BrowseFilter): boolean => filterParams(filter).length > 0;

export const filterFrom = (from: BrowseFilter): BrowseFilter =>
  browseFilter(new URLSearchParams(filterParams(from)));

export const sameFilter = (a: BrowseFilter, b: BrowseFilter): boolean =>
  `${new URLSearchParams(filterParams(a))}` === `${new URLSearchParams(filterParams(b))}`;

export const pageSize = 50;

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
  asOf: string;
  fixture: boolean;
  // http(s) locations only.
  locations?: Readonly<Record<string, string>>;
  choices?: { sources: Choice[]; people: Choice[] };
};

export type Choice = { id: string; name: string };

// A connection's identity and options only: its secret never enters this view.
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
  lastSync: { new: number; changed: number; removed: number };
  problem: string | null;
  report: readonly string[];
  state: "open" | "waiting" | "shut";
  flagged: boolean;
  own: boolean;
  through: string | null;
  picks: ConnectionPick[];
};

export type ConnectionPick = {
  name: string;
  label: string;
  many: boolean;
  most: number | null;
  unpicked: string;
  unlisted: string | null;
  picked: string[];
};

export type ConnectionsView = {
  connections: ConnectionView[];
  connectable: string[];
  refused: Readonly<Record<string, string>>;
  picker: boolean;
  standingIn: string[];
  servers: SourceServersView;
};

export type FoundServerView = { kind: string; server: string; known: string; on: boolean };

export type SourceServersView = {
  agent: string | null;
  looking: boolean;
  problem: string | null;
  noAgent: boolean;
  found: FoundServerView[];
  kinds: {
    kind: string;
    on: boolean;
    server: string | null;
    offBy: "person" | "agent" | null;
    problem?: string | null;
  }[];
  missing: { kind: string; server: string; instructions: string }[];
  card: {
    appeared: FoundServerView[];
    gone: { kind: string; server: string; on: boolean }[];
  } | null;
  sync: { every: number | null };
};

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
  outline: ReviewOutline[] | null;
};

export type ReviewRedrawn = {
  given: Record<string, unknown>;
  tables: ReviewTable[];
  options: Record<string, unknown> | null;
  said: string[];
  problem: string | null;
};

export type PickChoiceView = {
  value: string;
  name: string;
  count: number | null;
  updatedAt: string | null;
  unlisted?: true;
};

export const threadStates = ["working", "done", "handed-off", "dropped"] as const;
export type ThreadStateId = (typeof threadStates)[number];

export type HeldFrom =
  | { kind: "review-link"; by: string; changeSetId: string }
  | { kind: "window-chat"; chatId: string }
  | { kind: "thread"; threadId: string };

export type NoteView =
  | { kind: "rejected"; changeSetId: string; via: "thread" | "review-link" }
  | { kind: "unrejected"; changeSetId: string }
  | { kind: "moving"; changeSetId: string; from: string; into: string; items: number }
  | { kind: "moved"; changeSetId: string; into: string; workstreams: WorkstreamRef[] }
  | { kind: "continued-in"; threadId: string };

export type WorkstreamRef = { id: string; name: string };

export type WaitingOn = "agent" | "held" | "draft" | "review" | "apply" | "stalled" | "reply";

export const waitsOnUser = (waiting: WaitingOn | null): boolean =>
  waiting === "held" ||
  waiting === "draft" ||
  waiting === "review" ||
  waiting === "stalled" ||
  waiting === "reply";

export const holding = (entries: readonly ChatEntry[]): boolean =>
  entries.some(
    (entry) =>
      (entry.kind === "held" || entry.kind === "draft" || entry.kind === "continue") &&
      entry.outcome === null,
  );

export const toReview = (set: { nextSteps: readonly { kind: string }[] }): boolean =>
  set.nextSteps.some((step) => step.kind !== "revert");

// An answer to an overview question isn't the user's turn, or every question would add
// itself to Needs you.
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

// Source content is text, never HTML.
export type ItemPanelView = {
  id: string;
  key: string;
  source: string;
  title: string | null;
  url: string | null;
  readAt: string;
  updatedAt: string | null;
  read:
    | { status: "ok"; blocks: PanelBlock[]; edit?: PanelEdit }
    | { status: "moved"; to: ItemRef }
    | { status: "gone"; reason: "deleted" | "forbidden" }
    | { status: "unreadable" };
};

export type ItemStampView = { id: string; updatedAt: string | null };

// `url` is set only for an http(s) location.
export type ItemRef = { id: string; key: string; title: string | null; url: string | null };

export type MemberView = { ref: ItemRef; row: ItemRow | null };

export type WorkstreamSummary = {
  id: string;
  name: string;
  origin:
    | { kind: "cluster"; grouping: string; label: string | null }
    | { kind: "picked" }
    | { kind: "thread" }
    | { kind: "window" };
  version: number;
  size: number;
  createdAt: string;
  threads: Record<ThreadStateId, number>;
  done: { at: string; by: "user" | "agent" | "tool" | "other" } | null;
};

export type WorkstreamChangeView = {
  version: number;
  at: string;
  added: ItemRef[];
  removed: ItemRef[];
  cause: "user" | "agent" | "tool" | "review-link" | "change-set" | "sync";
  thread?: { id: string; title: string | null };
  tool?: string;
  undo?: UndoView | null;
};

export type ThreadSummaryView = {
  id: string;
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
  suggested?: MemberView[];
};

export type WorkstreamsView = { workstreams: WorkstreamSummary[] };

export type WorkstreamDeletedView = { threads: number };

export type WorkstreamEndedView = WorkstreamView & { carried: number };

// The host's sentence is the record of what it did, never the model's own reply.
export type ActionLineView = {
  text: string;
  applied: boolean;
  undone?: true;
  why: string | null;
  touched: { kind: "workstream" | "thread"; id: string } | null;
  undo: UndoView | null;
};

export type UndoView = { action: string; input: unknown };

export type ContinuedView = { thread: string; kept: boolean };
export type Undoable<T> = T & { undo: UndoView | null };

export type ThreadsView = { threads: ThreadSummaryView[] };

// Oriel draws a chip from the index and its own data, never from the agent's words.
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

export type Chips = Readonly<Record<string, ChipView | null>>;

export type Quotes = Readonly<Record<string, boolean>>;

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

export type RunView = {
  outcome: "ok" | "threw" | "timeout" | "limit";
  wallMs: number;
  reads: { fn: string; status: string; outsideRegion: boolean | null }[];
  mutations: number;
  logs: string[];
  returned: string | null;
  error: { phase: string; message: string; hint: string | null } | null;
};

// Typed data, never HTML.
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
  | { form: "preview"; tables: { name: string; columns: string[]; rows: (string | null)[][] }[] }
  | ChartBlock
);

export type NoticedSubjectView = SignalSubject;

export type NoticedCardView = {
  signal: string;
  kind: SignalKind;
  subject: NoticedSubjectView;
  headline: string;
  rule: string;
  why: string | null;
  quote: { item: string; text: string } | null;
  block: BlockView | null;
  pinned: string | null;
};

export type PinView = { id: string; block: BlockView | null };

export type NoticedView = {
  status: "ready" | "running" | "quiet" | "no-ai" | "failed";
  cards: NoticedCardView[];
  pins: PinView[];
  chips: Chips;
  foundAt: string | null;
  model: string | null;
  taught: string[];
  problem: string | null;
};

// The agent's HTML, framed from `src` on the sketch origin in a sandboxed frame.
export type SketchView = { src: string; height: 240 | 400 | 640 };

export type DraftChange = { option: string; was: unknown; drafted: unknown };

export type AboutView = { id: string; outside: boolean }[];

export type ChatEntry = { seq: number; at: string } & (
  | { kind: "user"; text: string; about?: AboutView }
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
  | { kind: "block"; block: BlockView }
  | { kind: "sketch"; sketch: SketchView }
  | { kind: "change-set"; changeSetId: string; revised?: true }
  | { kind: "actions"; lines: ActionLineView[] }
  | { kind: "held"; from: HeldFrom; text: string; outcome: "sent" | "discarded" | null }
  | {
      kind: "draft";
      connection: { id: string; name: string } | null;
      changes: DraftChange[];
      tables: ReviewTable[] | null;
      said: string[];
      stale: boolean;
      outcome: "applied" | "discarded" | null;
    }
  | {
      kind: "continue";
      item: ItemRef;
      workstream: string | null;
      thread: string | null;
      outcome: "applied" | "discarded" | null;
    }
  | { kind: "note"; note: NoteView }
  | { kind: "limit"; reason: string }
  | { kind: "error"; message: string; tryAgain?: true }
  | { kind: "done" }
);

export type ChangeSetStatus =
  | "open"
  | "approved"
  | "stopped"
  | "rejected"
  | "applied"
  | "partial"
  | "applying";

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
  nextSteps: NextStepView[];
  applying: boolean;
  stalled: boolean;
  // A change was sent with no answer, so it may already have been made.
  sentUnapplied: boolean;
  readOnly?: boolean;
  decision: {
    kind: "approved" | "rejected";
    via: "thread" | "review-link";
    by: string;
    at: string;
  } | null;
  // `sent`: it went out with no answer, so it may have been made.
  errors: { mutationId: string; error: string; sent: boolean }[];
  revertOf: string | null;
  reverts: string[];
  cannotUndo?: string;
  createdAt: string;
  revisedAt: string | null;
  secondLook?: SecondLookView | null;
};

export type SecondLookView = {
  id: string;
  state: "running" | "ready" | "failed";
  findings: {
    kind: "conflict" | "discussion" | "companion" | "related";
    lines: number[];
    says: string;
    evidence: (
      | { id: string; line: null; quote: string; outside: boolean }
      | { id: null; line: number; quote: string; outside: false }
    )[];
    changes: number[];
  }[];
  companions: { place: number; sentence: string; added: boolean }[];
  coverage: { read: string[]; of: number; searches: number } | null;
  stale: { diff: boolean; items: string[] };
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  dismissed: boolean;
};

export type ItemValue = {
  title: string | null;
  key: string | null;
  url: string | null;
  created: boolean;
};

export type DiffView = {
  changeSetId: string;
  hash: string;
  lines: {
    mutationId: string;
    sentence: string;
    target: ItemRef | null;
    kind: "create" | "change" | "delete";
    makes: string | null;
    source: string;
    applied: boolean;
    error: string | null;
    dismissed: boolean;
    check: { refused: string } | { later: string } | null;
    brought: { key: string; by: "agent" | "tool" }[];
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
  windowChat?: true;
  workstream: { id: string; name: string; version: number; items?: number };
  state: ThreadStateId;
  doneBy: "applied" | "marked" | null;
  regionVersion: number;
  syncedAt: string;
  members: MemberView[];
  move?: { went: WorkstreamRef[] | null };
  entries: ChatEntry[];
  lastSeq: number;
  running: boolean;
  changeSets: ChangeSetView[];
  writable: boolean;
  chips: Chips;
  quotes: Quotes;
};

export type StreamEvent =
  | { type: "entry"; entry: ChatEntry }
  | {
      type: "status";
      running: boolean;
      state: ThreadStateId;
      regionVersion: number;
      title?: string | null;
    }
  | { type: "change-set"; changeSetId: string; applying: boolean; look?: true }
  | { type: "workstream" }
  | { type: "chat" }
  | { type: "threads" }
  | { type: "deleted" };

export type DeletionView = {
  applied: number;
  reverted: number;
  unconfirmed: number;
  sources: string[];
};

export type DeletedView = { workstreamId: string; workstreamRemoved: boolean };

export type ReviewView = { changeSet: ChangeSetView; diff: DiffView };

export type ErrorReply = { error: string };

// Every figure here is computed, never by a model. Source text is text, never HTML.
export type OverviewView = {
  asOf: string;
  // Leaving the overview marks this seen, so an entry that commits after it was built
  // stays unseen.
  seq: number;
  lastSeen: string | null;
  counts: {
    changed: number;
    workstreamsMoved: number;
    needsYou: number;
    notInWorkstream: number;
  };
  changed: { workstreams: { id: string; name: string; moved: number }[]; elsewhere: number };
  needsYou: {
    threads: ThreadSummaryView[];
    unopened: UnopenedLinkView[];
  };
  headlines: HeadlineView[];
  workstreams: WorkstreamRowView[];
  candidates: { rows: CandidateView[]; total: number };
  people: { rows: PersonRowView[]; total: number };
};

export type UnopenedLinkView = {
  changeSetId: string;
  thread: { id: string; title: string | null };
  workstream: { id: string; name: string };
  sentAt: string;
};

export type OverviewRef =
  | { kind: "workstream"; id: string; name: string }
  | { kind: "item"; item: ItemRef };

export type HeadlineView = {
  id: "moved" | "quiet" | "talked" | "top";
  label: string;
  rule: string;
  subject: OverviewRef;
  detail: string;
};

export type SignalView = { text: string; rule: string };

export type WorkstreamRowView = {
  id: string;
  name: string;
  size: number;
  bySource: { source: string; count: number }[];
  status: Record<StatusCategory, number>;
  moved: number;
  movedDone: number;
  movedItems: ItemRef[];
  activity: number[];
  lastActivity: string;
  idleDays: number;
  quiet: boolean;
  threads: { working: number; waiting: number; done: number; dropped: number };
  signals: SignalView[];
};

export type CandidateView = {
  subject:
    | { kind: "item"; item: ItemRef }
    | {
        kind: "cluster";
        grouping: GroupingId;
        key: string;
        label: string;
        lead: ItemRef | null;
        size: number;
      };
  rule: string;
  source: string;
  weight: number;
  detail: string | null;
  changedAt: string;
};

export type PersonRowView = {
  id: string;
  name: string;
  inProgress: number;
  top: { id: string; name: string; count: number } | null;
};

// `api` is `.env`'s key, under `pnpm dev --agent api` only, never a provider Settings keeps.
export const providerKinds = ["claude-code", "codex", "api"] as const;
export type ProviderKind = (typeof providerKinds)[number];
export const textSizes = ["small", "default", "large"] as const;
export type TextSize = (typeof textSizes)[number];
export const sendKeys = ["enter", "mod-enter"] as const;
export type SendKey = (typeof sendKeys)[number];
export type ModelPick = { provider: string; model: string };

export type ProviderStatus =
  | "ready"
  | "missing"
  | "unsupported"
  | "signed-out"
  | "untrusted"
  | "checking";

// `detail` never holds a key.
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

// `cliPaths`: only the desktop app, behind its launch secret, lets a CLI's path be set.
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
  notify: boolean;
  notifies: boolean;
  askBeforeQuitting: boolean;
  asksBeforeQuitting: boolean;
  timeFormat: TimeFormat;
  afterApprove: AfterApprove;
  sourceSync: number | null;
};

export type UsageCountsView = { turns: number; inputTokens: number; outputTokens: number };

export type PlanWindowView = {
  kind: "session" | "week";
  usedPercent: number;
  resetsAt: string | null;
};

export type UsageView = {
  provider: string;
  today: UsageCountsView;
  plan: { windows: PlanWindowView[] } | { none: "no-plan" | "no-answer" | "not-ready" };
};

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

export const timeFormats = ["relative", "absolute"] as const;
export type TimeFormat = (typeof timeFormats)[number];

export const afterApproves = ["stay", "next"] as const;
export type AfterApprove = (typeof afterApproves)[number];

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
  // Shown, never stored.
  account: { plan: string | null; email: string | null; personal: boolean } | null;
  running: { command: CliCommand; phase: CliPhase; ms: number } | null;
  update: { by: "oriel" } | { by: "person"; command: string } | null;
  // Its log is redacted: no password, key, code, email or link query.
  failed: {
    what: CliCommand | "test";
    why: CliFailure;
    sentence: string;
    log: string[];
    resets: string | null;
  } | null;
};

export type FirstRunView = {
  step: "ai" | "work" | "finished";
  steps: { ai: "done" | "skipped" | null; work: "done" | "skipped" | null };
  firstRun: boolean;
  line: boolean;
  reading: { project: string; read: number; total: number | null; stopped: boolean } | null;
};

export type SetupView = {
  providers: ProviderView[];
  cli: CliView | null;
  codex: CliView | null;
  firstRun: FirstRunView | null;
};
