// Builders for the views in src/view.ts, for the web tests. Each fills every
// field with a default and takes overrides, so a new field in a view is one
// default here rather than an edit in every test file. A test passes as an
// override every field it depends on, even one equal to its default.
// This file sits beside test/, not in it: `node --test` runs every file
// under test/ as a test.
import type {
  ActionLineView,
  ChangeSetView,
  ClusterRow,
  DiffView,
  ItemRef,
  ItemRow,
  MemberView,
  SearchResultView,
  ThreadSummaryView,
  ThreadView,
  WindowView,
  WorkstreamSummary,
  WorkstreamView,
} from "./src/view.ts";

const at = "2026-10-29T09:00:00.000Z";
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

export const clusterRow = (over: Partial<ClusterRow> = {}): ClusterRow => ({
  key: "10001",
  label: "Checkout",
  origin: { kind: "source", source: "Jira" },
  anchor: null,
  count: 0,
  points: 0,
  estimated: 0,
  unestimated: 0,
  status: { todo: 0, "in-progress": 0, done: 0 },
  ...over,
});

export const windowView = (over: Partial<WindowView> = {}): WindowView => ({
  grouping: "epic",
  clusters: [],
  items: 0,
  asOf: at,
  fixture: true,
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

// `lastSeq` is the last entry's unless given.
export const threadView = (over: Partial<ThreadView> = {}): ThreadView => ({
  id: threadId,
  title: null,
  workstream: { id: workstreamId, name: "Launch", version: 1 },
  state: "working",
  doneBy: null,
  regionVersion: 1,
  members: [],
  entries: [],
  lastSeq: over.entries?.at(-1)?.seq ?? 0,
  running: false,
  changeSets: [],
  writable: true,
  ...over,
});

export const searchResult = (over: Partial<SearchResultView> = {}): SearchResultView => ({
  thread: {
    id: threadId,
    title: null,
    state: "working",
    workstream: { id: workstreamId, name: "Launch" },
  },
  changeSet: null,
  matched: "name",
  excerpt: "",
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
