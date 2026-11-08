// Builders for the views in src/view.ts, for the web tests. Each fills every
// field with a default and takes overrides, so a new field in a view is one
// default here rather than an edit in every test file. A test passes as an
// override every field it depends on, even one equal to its default.
// This file sits beside test/, not in it: `node --test` runs every file
// under test/ as a test.
import type { Connectors } from "./src/connectors.ts";
import type {
  ConnectOffer,
  ActionLineView,
  ChangeSetView,
  ConnectorView,
  ConnectionView,
  DiffView,
  ItemRef,
  ItemRow,
  MemberView,
  OverviewView,
  SettingsView,
  SourceServersView,
  ThreadSummaryView,
  ThreadView,
  WorkstreamSummary,
  WorkstreamView,
} from "./src/view.ts";

const at = "2026-10-29T09:00:00.000Z";

// A connector's offer in the first run, as its declaration words it.
const offer = (over: Partial<ConnectOffer>): ConnectOffer => ({
  mark: "?",
  title: "",
  about: "",
  counts: "item",
  empty: "",
  yours: "",
  changes: "",
  ready: "",
  catchUp: "",
  ...over,
});

// How every connector shows, as /api/connectors sends it, with its offer and
// steps in short; packages/server's api test holds its own fields to the
// declarations.
export const connectorViews: ConnectorView[] = [
  {
    kind: "jira",
    name: "Jira",
    inSentence: "Jira",
    icon: "ticket",
    keysReadAs: null,
    columns: ["assignee", "estimate"],
    writable: true,
    offer: offer({
      firstRun: 1,
      mark: "J",
      title: "Jira",
      counts: "issue",
      yours: "your Jira",
      changes: "Jira",
      follow: "an epic",
      invite: { note: "Your epics.", readOnly: "Only reads.", connected: "has no issues yet." },
    }),
    connect: null,
    review: null,
    options: [{ kind: "read-only", name: "readOnly" }],
    standIn: null,
  },
  {
    kind: "folder",
    name: "Folder",
    inSentence: "the folder",
    icon: "page",
    keysReadAs: "File",
    columns: [],
    writable: false,
    offer: offer({
      firstRun: 2,
      mark: "F",
      title: "A folder",
      counts: "file",
      yours: "your notes",
      changes: "your files",
    }),
    connect: {
      steps: [
        {
          kind: "folder",
          field: "path",
          prompt: "Choose a folder.",
          what: "A folder.",
          choose: "Choose a folder",
          another: "Choose another",
          waiting: "Waiting…",
          label: "A folder, by its path",
          placeholder: "~/notes",
          note: "Read only.",
        },
      ],
    },
    review: null,
    options: [],
    standIn: null,
  },
  {
    kind: "slack",
    name: "Slack",
    inSentence: "Slack",
    icon: "message",
    keysReadAs: "Message",
    columns: ["replies"],
    writable: true,
    offer: null,
    connect: null,
    review: null,
    options: [],
    standIn: null,
  },
];
export const connectors: Connectors = Object.fromEntries(
  connectorViews.map((view) => [view.kind, view]),
);
const threadId = "01JBZ0000000000000000000T1";
const workstreamId = "01JBZ0000000000000000000G1";
const changeSetId = "01JBZ0000000000000000000C1";

export const itemRef = (over: Partial<ItemRef> = {}): ItemRef => ({
  id: "jira:SYN-1",
  key: "SYN-1",
  title: "Title SYN-1",
  url: null,
  ...over,
});

export const itemRow = (over: Partial<ItemRow> = {}): ItemRow => ({
  id: "jira:SYN-1",
  key: "SYN-1",
  title: "Title SYN-1",
  type: "Story",
  status: null,
  assignee: null,
  points: null,
  idleDays: 0,
  ...over,
});

export const memberView = (over: Partial<MemberView> = {}): MemberView => ({
  ref: itemRef(),
  row: itemRow(),
  ...over,
});

// A connection, open: Jira's first, reading SYN, unless overridden.
export const connectionView = (over: Partial<ConnectionView> = {}): ConnectionView => ({
  id: "01JBZ0000000000000000000K1",
  kind: "jira",
  number: 1,
  prefix: "jira",
  name: "Jira",
  named: false,
  about: "SYN on oriel.atlassian.net",
  reads: "SYN",
  identity: "https://oriel.atlassian.net",
  options: { project: "SYN" },
  readOnly: false,
  viewOnly: null,
  every: null,
  items: 0,
  syncedAt: null,
  lastSync: { new: 0, changed: 0, removed: 0 },
  problem: null,
  report: [],
  state: "open",
  flagged: false,
  own: false,
  through: null,
  picks: [],
  ...over,
});

// What Oriel found in the person's agent: nothing yet, unless overridden.
export const serversView = (over: Partial<SourceServersView> = {}): SourceServersView => ({
  agent: "Claude Code",
  looking: false,
  problem: null,
  found: [],
  kinds: [],
  missing: [],
  card: null,
  sync: { every: null, plan: true },
  ...over,
});

export const workstreamSummary = (over: Partial<WorkstreamSummary> = {}): WorkstreamSummary => ({
  id: workstreamId,
  name: "Launch",
  origin: { kind: "picked" },
  version: 1,
  size: 0,
  createdAt: at,
  threads: { working: 0, done: 0, "handed-off": 0, dropped: 0 },
  done: null,
  ...over,
});

export const workstreamView = (over: Partial<WorkstreamView> = {}): WorkstreamView => ({
  workstream: workstreamSummary(),
  members: [],
  changes: [],
  threads: [],
  ...over,
});

export const threadSummary = (over: Partial<ThreadSummaryView> = {}): ThreadSummaryView => ({
  id: threadId,
  title: null,
  workstream: { id: workstreamId, name: "Launch" },
  state: "working",
  doneBy: null,
  waitingOn: null,
  activityAt: at,
  ...over,
});

export const changeSetView = (over: Partial<ChangeSetView> = {}): ChangeSetView => ({
  id: changeSetId,
  status: "open",
  nextSteps: [{ kind: "approve" }, { kind: "reject" }],
  applying: false,
  stalled: false,
  sentUnapplied: false,
  decision: null,
  errors: [],
  revertOf: null,
  reverts: [],
  createdAt: at,
  ...over,
});

export const diffView = (over: Partial<DiffView> = {}): DiffView => ({
  changeSetId,
  hash: "h",
  lines: [],
  ...over,
});

// One line of a diff: an edit in Jira, unless overridden.
export const diffLine = (
  over: Partial<DiffView["lines"][number]> = {},
): DiffView["lines"][number] => ({
  mutationId: "m1",
  sentence: "Change it.",
  target: null,
  kind: "change",
  makes: null,
  source: "Jira",
  applied: false,
  error: null,
  brought: [],
  fields: [],
  ...over,
});

export const settingsView = (over: Partial<SettingsView> = {}): SettingsView => ({
  providers: [],
  models: [],
  model: null,
  titleModel: null,
  scripted: true,
  cliPaths: false,
  apiKeys: false,
  theme: "graphite",
  themes: ["graphite"],
  textSize: "default",
  send: "enter",
  notify: true,
  notifies: false,
  askBeforeQuitting: true,
  asksBeforeQuitting: false,
  timeFormat: "relative",
  afterApprove: "stay",
  sourceSync: null,
  ...over,
});

export const threadView = (over: Partial<ThreadView> = {}): ThreadView => ({
  id: threadId,
  title: null,
  workstream: { id: workstreamId, name: "Launch", version: 1 },
  state: "working",
  doneBy: null,
  regionVersion: 1,
  members: [],
  entries: [],
  lastSeq: 0,
  running: false,
  changeSets: [],
  writable: true,
  chips: {},
  quotes: {},
  ...over,
});

export const actionLine = (over: Partial<ActionLineView> = {}): ActionLineView => ({
  text: "",
  applied: true,
  why: null,
  touched: null,
  undo: null,
  ...over,
});

export const overviewView = (over: Partial<OverviewView> = {}): OverviewView => ({
  asOf: at,
  seq: 7,
  lastSeen: null,
  counts: { changed: 0, workstreamsMoved: 0, needsYou: 0, notInWorkstream: 0 },
  changed: { workstreams: [], elsewhere: 0 },
  needsYou: { threads: [], unopened: [] },
  headlines: [],
  workstreams: [],
  candidates: { rows: [], total: 0 },
  people: { rows: [], total: 0 },
  ...over,
});
