// The whole app as one program: where the page is, and each page's own
// model. Pages update themselves; this routes messages and replies to them,
// and keeps the workstreams and threads lists the chrome shows.
import { type LookItem, type LookingAt, lookedAt } from "./looking.ts";
import {
  accepted,
  approvedIn,
  answered,
  type ApprovedModel,
  type ApprovedMsg,
  arriving,
  focusing,
  initApproved,
  sending,
  updateApproved,
} from "./approved.ts";
import {
  initRejected,
  noted,
  rejectedIn,
  type RejectedModel,
  type RejectedMsg,
  rejectedReplied,
  updateRejected,
} from "./rejected.ts";
import {
  type ClosingModel,
  type ClosingMsg,
  closingReplied,
  deletedOf,
  initClosing,
  updateClosing,
} from "./closing.ts";
import {
  type WorkstreamModel,
  type WorkstreamMsg,
  workstreamReplied,
  initWorkstream,
  updateWorkstream,
} from "./workstream.ts";
import {
  deleted as deletedWorkstream,
  type EndingModel,
  type EndingMsg,
  endingAnswered,
  initEnding,
  leftPage,
  updateEnding,
} from "./ending.ts";
import {
  initMoving,
  type MovingModel,
  type MovingMsg,
  movingReplied,
  updateMoving,
} from "./moving.ts";
import { type Connectors, connectorsReplied, loadConnectors, noConnectors } from "./connectors.ts";
import { type Effect, errorOf, get, post, type Replied, report, type Tag } from "./http.ts";
import { samePage, withItem } from "./nav.ts";
import {
  type ConnectionsModel,
  type ConnectionsMsg,
  connectionsReplied,
  initConnections,
  loadConnections,
  updateConnections,
} from "./connections.ts";
import type { Hold } from "./undos.ts";
import {
  checkPanel,
  type CurrentWorkstream,
  type Glimpse,
  openPanel,
  type PanelModel,
  type PanelMsg,
  panelName,
  panelReplied,
  stepped,
  updatePanel,
} from "./panel.ts";
import {
  addsLeft,
  addsReplied,
  checkAdd,
  holdAdds,
  noAdds,
  type PanelAddMsg,
  type PanelAdds,
  recheckAdd,
  shownOf,
  standingAdds,
  updateAdds,
} from "./panel-adds.ts";
import {
  editsLeft,
  editsReplied,
  holdEdits,
  noEdits,
  type PanelEditMsg,
  type PanelEdits,
  updateEdits,
} from "./panel-edits.ts";
import {
  initOverview,
  leaving as left,
  loadNoticed,
  loadOverview,
  type OverviewModel,
  type OverviewMsg,
  madeReplied,
  noticedReplied,
  overviewReplied,
  updateOverview,
} from "./overview.ts";
import {
  initWindowChat,
  loadWindowChat,
  updateWindowChat,
  type WindowChatModel,
  type WindowChatMsg,
  windowChatReplied,
} from "./window-chat.ts";
import {
  initReview,
  type ReviewModel,
  type ReviewMsg,
  reviewReplied,
  updateReview,
} from "./review.ts";
import { type Route, routeUrl } from "./route.ts";
import {
  initSetup,
  loadSetup,
  openSetup,
  type SetupModel,
  type SetupMsg,
  setupReplied,
  updateSetup,
} from "./setup.ts";
import {
  initSettings,
  loadSettings,
  noAi,
  type SettingsModel,
  type SettingsMsg,
  settingsReplied,
  loadUsage,
  updateSettings,
} from "./settings.ts";
import {
  initSearch,
  type SearchModel,
  type SearchMsg,
  searchReplied,
  updateSearch,
} from "./search.ts";
import {
  initNewThread,
  initThread,
  keptAtLatest,
  type NewThreadModel,
  type NewThreadMsg,
  newThreadReplied,
  reconnected,
  refresh as refreshThread,
  streamed,
  type ThreadModel,
  type ThreadMsg,
  threadReplied,
  updateNewThread,
  updateThread,
  unfolding,
} from "./thread.ts";
import {
  init as initWindow,
  type Model as WindowModel,
  type Msg as WindowMsg,
  update as updateWindow,
  windowRoute,
} from "./update.ts";
import type {
  ChipView,
  WorkstreamsView,
  WorkstreamSummary,
  ThreadsView,
  StreamEvent,
  ThreadSummaryView,
  WorkstreamView,
} from "./view.ts";

// A chat entry, by its thread and place.
type Under = { thread: string; seq: number };

export type Model = {
  route: Route;
  overview: OverviewModel | null;
  // The window chat's ask bar and whether it is open. While the overview is
  // on screen, its thread is `thread`.
  chat: WindowChatModel;
  window: WindowModel | null;
  workstream: WorkstreamModel | null;
  thread: ThreadModel | null;
  // A thread from nothing, until its first message starts it, and how many
  // such drafts were opened, which numbers them.
  newThread: NewThreadModel | null;
  drafts: number;
  review: ReviewModel | null;
  // Every connection: at the foot of the sidebar, to sync; in the first run
  // and on the overview, to make; and in Settings, to set.
  connections: ConnectionsModel;
  // How every connector shows, connected or not.
  connectors: Connectors;
  // For the chrome: the workspace's workstreams and threads.
  workstreams: WorkstreamSummary[] | null;
  threads: ThreadSummaryView[] | null;
  // Threads being marked done or deleted from a list of them.
  closing: ClosingModel;
  // Workstreams being marked done, reopened or deleted, from wherever, and
  // what was last done, with its Undo.
  ending: EndingModel;
  // An item being moved to another workstream, by a drag or its row's menu,
  // and what the last move did, with its Undo.
  moving: MovingModel;
  // The item open in the panel beside the page, as the route names it.
  panel: PanelModel | null;
  // The list on the page the open item was opened from, by item ID, which
  // the panel steps through; null when it wasn't opened from one.
  panelList: readonly string[] | null;
  // The chat entry the open item was opened from, if it was (decision 0062).
  panelUnder: Under | null;
  // Below 1100, where the item lies over a conversation: the person gave
  // the conversation the screen with "Chat", and the item is a line above
  // its composer until Show (dock.tsx). Opening another item, or closing
  // it, unfolds it.
  panelFolded: boolean;
  // The panel's last add of each item to each workstream, whatever item the
  // panel shows: in flight, or what came of it, with its Undo while that
  // shows.
  panelAdds: PanelAdds;
  // A stand-in's item's form open in the panel, and the edits saved, with
  // their Undos while they show (decision 0059).
  panelEdits: PanelEdits;
  // The sidebar's search over the workspace's threads.
  search: SearchModel;
  // The person's settings: Settings' page, and which key sends a question
  // on every page.
  settings: SettingsModel;
  // The desktop app's first run, and the Claude Code and Codex rows
  // Settings shares with it (decisions 0038 and 0048).
  setup: SetupModel;
  // Where an approval in a thread took the page, as a note in the stack of
  // Undo notes.
  approved: ApprovedModel;
  // A rejection in a thread, with its Undo, as another (OA-258).
  rejected: RejectedModel;
};

export type Msg =
  | { type: "overview"; msg: OverviewMsg }
  | { type: "chat"; msg: WindowChatMsg }
  | { type: "window"; msg: WindowMsg }
  | { type: "workstream"; msg: WorkstreamMsg }
  | { type: "thread"; msg: ThreadMsg }
  | { type: "newThread"; msg: NewThreadMsg }
  | { type: "review"; msg: ReviewMsg }
  | { type: "connections"; msg: ConnectionsMsg }
  | { type: "closing"; msg: ClosingMsg }
  | { type: "ending"; msg: EndingMsg }
  | { type: "moving"; msg: MovingMsg }
  | { type: "panel"; msg: PanelMsg }
  | { type: "panelAdd"; msg: PanelAddMsg }
  | { type: "panelEdit"; msg: PanelEditMsg }
  | { type: "approved"; msg: ApprovedMsg }
  | { type: "rejected"; msg: RejectedMsg }
  // The pointer or keyboard came onto the stack of Undo notes, or left it,
  // which holds every note in it, of every kind.
  | { type: "undoHeld"; by: Hold; held: boolean }
  | { type: "search"; msg: SearchMsg }
  | { type: "settings"; msg: SettingsMsg }
  | { type: "setup"; msg: SetupMsg }
  // A plain click on a link to an item: it opens in the panel. `list`: the
  // list on the page that holds the link, by item ID.
  // `under`: the chat entry that holds the link.
  | { type: "itemOpened"; id: string; list?: readonly string[]; under?: Under }
  // The next or previous item in that list, in the panel.
  | { type: "panelStepped"; by: 1 | -1 }
  | { type: "panelClosed" }
  // "Chat" in the panel's dock folds the item; Show unfolds it.
  | { type: "panelFolded"; folded: boolean }
  // "Ask about this" in a panel that isn't beside a conversation: the
  // overview, with the item still open and the window chat beside it.
  | { type: "askAboutClicked" }
  // The user left for an item's source: from its panel, or by a Cmd/Ctrl or
  // middle click on a link to it. The browser goes; this only tells.
  | { type: "sourceOpened"; id: string; via: "panel" | "link" }
  // The person regrouped a pivot block in the window (decision 0053). The
  // window only tells: the grids were Oriel's already.
  | { type: "pivotRegrouped" }
  // A workstream renamed in place, in a list, from its menu: through the
  // same rename its page makes.
  | { type: "workstreamRenamed"; id: string; name: string }
  // A link inside the app was followed.
  | { type: "linkClicked"; route: Route }
  // The page changed: after a link, or back and forward.
  | { type: "routed"; route: Route }
  | { type: "streamed"; event: StreamEvent }
  // The thread's stream reconnected after dropping.
  | { type: "streamReopened" }
  // The workspace changed: some thread's turn started or ended, a change set
  // of one moved, or one of Oriel's own actions changed a workstream or thread,
  // in this tab or another.
  | { type: "threadsMoved" }
  | Replied;

// What the sidebar shows, loaded on entering any page. The workstreams load again
// when their counts may have moved, since the sidebar shows them beside the
// page that moved them.
const loadWorkstreams: Effect = get("/api/workstreams", { kind: "workstreams" });
const loadThreads: Effect = get("/api/threads", { kind: "threads" });
const lists: Effect[] = [loadWorkstreams, loadThreads, loadConnections];

// The workstream or thread on screen, loaded again.
const reloadShown = (model: Model): Effect[] => {
  const { route, workstream, thread } = model;
  // One deleted, or being deleted, is gone until its Undo, which loads it then.
  if (route.page === "workstream" && workstream && !deletedWorkstream(model.ending, workstream.id))
    return [
      get(`/api/workstreams/${workstream.id}`, { kind: "workstreamSynced", id: workstream.id }),
    ];
  if (route.page === "thread" && thread) return [refreshThread(thread)];
  return [];
};

// Once a source connected or synced, what's on screen shows what changed
// there: new items in the window, a member deleted in its source as gone on
// a workstream's page or in a thread's rail, and the sources' list itself,
// with `reload`, what the reply didn't bring.
function sourceSynced(model: Model, reload: Effect[]): [Model, Effect[]] {
  const [window, effects] = model.window
    ? updateWindow(model.window, { type: "retryClicked" })
    : [null, []];
  const overview = model.route.page === "overview" ? [loadOverview] : [];
  return [
    { ...model, window },
    [...effects, ...reloadShown(model), ...overview, ...reload, loadConnections],
  ];
}

// However the workspace changed, and whoever changed it, every page hears it
// the same way: the lists load again, and so does a workstream's page or the
// overview on screen. A thread's page hears its own thread, and its
// workstream, on its own stream.
const workspaceChanged = (model: Model): Effect[] => [
  loadThreads,
  loadWorkstreams,
  // What Oriel found in the person's agent, and what's on (decision 0059),
  // which a look of its own changes.
  loadConnections,
  ...(model.route.page === "workstream" ? reloadShown(model) : []),
  ...(model.route.page === "overview" ? [loadOverview, loadNoticed] : []),
  // The first run's overview ends with the first workstream made.
  ...(model.setup.view?.firstRun?.firstRun ? [loadSetup] : []),
  // A thread shown whose chips name a thread, a change set or a workstream,
  // any of which may have moved, or come back with an Undo (decision 0032).
  ...(model.thread?.view && Object.entries(model.thread.view.chips).some(oriels)
    ? [refreshThread(model.thread)]
    : []),
];

// A chip of Oriel's own, by ID: an item's ID names its source.
const oriels = ([id, chip]: [string, ChipView | null]) =>
  chip === null ? !id.includes(":") : chip.kind !== "item";

export function init(route: Route): [Model, Effect[]] {
  const empty: Model = {
    route,
    overview: null,
    chat: initWindowChat(),
    window: null,
    workstream: null,
    thread: null,
    newThread: null,
    drafts: 0,
    review: null,
    connections: initConnections(),
    connectors: noConnectors,
    workstreams: null,
    threads: null,
    closing: initClosing(),
    ending: initEnding(),
    moving: initMoving(),
    panel: null,
    panelList: null,
    panelUnder: null,
    panelFolded: false,
    panelAdds: noAdds,
    panelEdits: noEdits,
    search: initSearch(),
    settings: initSettings(),
    setup: initSetup(),
    approved: initApproved(),
    rejected: initRejected(),
  };
  const [model, effects] = enter(empty, route);
  // A review link's page isn't the person's, so it keeps the default look.
  const settings = route.page === "review" || route.page === "settings" ? [] : [loadSettings];
  // The first run, which the overview and Settings show parts of too.
  const setup = route.page === "review" || route.page === "setup" ? [] : [loadSetup];
  // Nor does it show the person's items as the window does.
  const connectors = route.page === "review" ? [] : [loadConnectors];
  return withPanel(model, [...effects, ...settings, ...setup, ...connectors]);
}

// The panel follows the route: it opens, reading the item, when the route
// names another item, and closes when it names none.
function withPanel(model: Model, effects: Effect[]): [Model, Effect[]] {
  const { item } = model.route;
  if (item === undefined) return [{ ...model, panel: null, panelFolded: false }, effects];
  if (model.panel?.id === item) return [model, effects];
  const [panel, opened] = openPanel(item, glimpseOf(model, item));
  const checked = checkAdd(model.panelAdds, item, model.workstreams);
  return [{ ...model, panel, panelFolded: false }, [...effects, ...opened, ...checked]];
}

// What the page on screen already shows of an item, from the index: a row
// in Browse, or a member of the workstream or thread open. The panel shows it
// while it reads the item from its source.
// Only the page on screen's: Browse keeps its rows between visits, which may
// be older than the page's.
function glimpseOf(model: Model, id: string): Glimpse | null {
  const { page } = model.route;
  const rows =
    page === "window"
      ? (model.window?.window?.clusters ?? []).flatMap(({ row, list }) => [
          ...(row.anchor ? [row.anchor] : []),
          ...list,
        ])
      : (page === "workstream"
          ? (model.workstream?.view?.members ?? [])
          : page === "thread"
            ? (model.thread?.view?.members ?? [])
            : []
        ).map((member) => member.row);
  const row = rows.find((each) => each?.id === id);
  return row ? { key: row.key, title: row.title, status: row.status?.name ?? null } : null;
}

// Sets up the page `route` names. The window keeps its state between visits,
// picked items included.
// What only the window knows happened, for pilot telemetry: the grouping
// switched, or a cluster opened or closed.
export function windowTelemetry(before: WindowModel, after: WindowModel): Effect[] {
  if (after.grouping !== before.grouping)
    return [report({ name: "grouping.switched", grouping: after.grouping })];
  const shown = after.window?.grouping;
  // Clusters a search opened as its window loaded aren't the user's.
  if (shown === undefined || after.open === before.open || after.window !== before.window)
    return [];
  const was = before.open[shown].length;
  const now = after.open[shown].length;
  if (now === was) return [];
  return [report({ name: now > was ? "cluster.opened" : "cluster.closed" })];
}

// A thread's page watches its events only while it is on screen: leaving
// stops watching, and entering, by a link, Back or the same link again,
// loads it fresh and watches again from its last entry.
function enter(model: Model, route: Route): [Model, Effect[]] {
  const leaving: Effect[] = [
    ...(model.thread ? [{ type: "unsubscribe" } as const] : []),
    ...(model.route.page === "overview" && route.page !== "overview" ? left(model.overview) : []),
  ];
  // A thread's own stream says when any thread moves; every other page
  // watches them all. A review link's page loads on its own, watching nothing.
  const watching: Effect[] = [
    { type: route.page === "thread" ? "unwatchThreads" : "watchThreads" },
  ];
  // A draft left behind is dropped: nothing was made for it.
  const base = {
    ...model,
    route,
    thread: null,
    newThread: null,
    ending: samePage(model.route, route) ? model.ending : leftPage(model.ending),
    panelAdds: samePage(model.route, route) ? model.panelAdds : addsLeft(model.panelAdds),
    panelEdits: samePage(model.route, route) ? model.panelEdits : editsLeft(model.panelEdits),
    panelList: samePage(model.route, route) ? model.panelList : null,
    approved: arriving(model.approved, route),
  };
  switch (route.page) {
    case "overview": {
      const [overview, effects] = initOverview();
      // What it showed until now stays on screen while it loads again.
      const kept = model.overview?.view
        ? { ...overview, view: model.overview.view, noticed: model.overview.noticed }
        : overview;
      return [
        { ...base, overview: kept },
        [...leaving, ...effects, loadWindowChat, ...lists, ...watching],
      ];
    }
    case "window": {
      if (model.window === null) {
        const [window, effects] = initWindow(route.grouping, route.addTo, route);
        return [{ ...base, window }, [...leaving, ...effects, ...lists, ...watching]];
      }
      // The address's filters, then its grouping, each loading the window
      // only if it changed; the last load stands.
      const [refiltered, filtering] = updateWindow(model.window, {
        type: "filterRouted",
        filter: route,
      });
      const [window, effects] =
        route.grouping === refiltered.grouping
          ? [refiltered, filtering]
          : updateWindow(refiltered, { type: "groupingPicked", grouping: route.grouping });
      const loads = effects.filter((effect) => effect.type === "loadWindow").slice(-1);
      return [
        { ...base, window: { ...window, addTo: route.addTo } },
        [...leaving, ...loads, ...lists, ...watching],
      ];
    }
    case "workstream": {
      const [workstream, effects] = initWorkstream(route.id);
      return [{ ...base, workstream }, [...leaving, ...effects, ...lists, ...watching]];
    }
    case "thread": {
      const [thread, effects] = initThread(route.id, route.changeSet ?? null);
      return [{ ...base, thread }, [...leaving, ...effects, ...lists, ...watching]];
    }
    case "new-thread":
      return [
        { ...base, newThread: initNewThread(model.drafts + 1), drafts: model.drafts + 1 },
        [...leaving, ...lists, ...watching],
      ];
    case "done":
      return [base, [...leaving, ...lists, ...watching]];
    // Settings load again on each visit, so the providers show what Oriel
    // found last.
    case "settings":
      return [base, [...leaving, loadSettings, loadUsage, loadSetup, ...lists, ...watching]];
    // The first run stands alone: what Oriel has found so far, then Claude
    // Code looked for again, and the sources.
    case "setup":
      return [base, [...leaving, loadSetup, openSetup, loadSettings, loadConnections]];
    case "review": {
      const [review, effects] = initReview(route.token);
      return [{ ...base, review }, [...leaving, ...effects]];
    }
  }
}

// When the window or the lists load again, something may have moved in the
// index, so an open panel asks whether its item changed since its read.
// However a thread's page changed, it scrolls the same way. However the user
// asked for a page, one already open stays as it is. An approval accepted
// may take the page on to the next thread that needs the user, whose
// heading takes focus once it loads.
export function update(model: Model, msg: Msg): [Model, Effect[]] {
  const [next, effects] = focused(
    ...staying(...standing(msg, ...movedOn(model, msg, ...updated(model, msg)))),
  );
  const moved = effects.some(
    (effect) =>
      effect.type === "loadWindow" || (effect.type === "http" && effect.tag.kind === "threads"),
  );
  const latest = next.thread ? keptAtLatest(model.thread, next.thread) : [];
  return [
    looking(next),
    [...effects, ...(moved && next.panel ? checkPanel(next.panel) : []), ...latest],
  ];
}

// Each composer on screen follows the item open beside it (decision 0062):
// the thread's, the window chat's first question's, the workstream page's
// Ask box and a new thread's, whose questions each start a thread.
function looking(model: Model): Model {
  const { panel } = model;
  const open = (threadId: string | null): LookItem | null => {
    if (!panel) return null;
    const under = model.panelUnder;
    return {
      id: panel.id,
      ...panelName(panel),
      under: under && under.thread === threadId ? under.seq : null,
    };
  };
  // A composer as it follows, the same one when nothing changed.
  const follow = <T extends { lookingAt: LookingAt; draft: string }>(
    composer: T,
    threadId: string | null,
  ): T => {
    const lookingAt = lookedAt(composer.lookingAt, open(threadId), composer.draft);
    return lookingAt === composer.lookingAt ? composer : { ...composer, lookingAt };
  };
  const thread = model.thread && follow(model.thread, model.thread.id);
  const chat = follow(model.chat, null);
  const workstream = model.workstream && follow(model.workstream, null);
  const newThread = model.newThread && follow(model.newThread, null);
  if (
    thread === model.thread &&
    chat === model.chat &&
    workstream === model.workstream &&
    newThread === model.newThread
  )
    return model;
  return { ...model, thread, chat, workstream, newThread };
}

// A question that starts a thread goes to it with the item it was about
// still open beside it (decision 0062): the item is the window's, not the
// page's.
const keepingItem = (model: Model, effects: Effect[]): Effect[] =>
  effects.map((effect) =>
    effect.type === "navigate" && effect.route.page === "thread"
      ? { ...effect, route: withItem(effect.route, model.route.item ?? null) }
      : effect,
  );

function movedOn(before: Model, msg: Msg, after: Model, effects: Effect[]): [Model, Effect[]] {
  const rejection = rejectedIn(before, msg);
  if (rejection) {
    const [rejected, expiry] = noted(after.rejected, rejection);
    return [{ ...after, rejected }, [...effects, ...expiry]];
  }
  const next = { ...after, approved: sending(after.approved, msg) };
  const changeSetId = accepted(before, msg);
  const [moved, going] = changeSetId === null ? [next, []] : approvedIn(before, next, changeSetId);
  const [approved, told] = answered(moved.approved, msg);
  if (approved === after.approved) return [after, effects];
  return [{ ...moved, approved }, [...effects, ...going, ...told]];
}

function focused(model: Model, effects: Effect[]): [Model, Effect[]] {
  const [next, focusingIt] = focusing(model);
  return [next, [...effects, ...focusingIt]];
}

// Replies whose body is a workstream's whole view: its version and its
// members from one read. A view a page merged from more than one, as after a
// rename or a thread's status, may pair a version with older members.
const wholeViews: ReadonlySet<Tag["kind"]> = new Set([
  "workstream",
  "workstreamSynced",
  "workstreamChanged",
  "panelAddChecked",
]);

// An add the panel made goes once a workstream, as Oriel answers with it,
// shows it undone some other way.
function standing(msg: Msg, model: Model, effects: Effect[]): [Model, Effect[]] {
  if (msg.type !== "replied" || !msg.ok || !wholeViews.has(msg.tag.kind)) return [model, effects];
  const panelAdds = standingAdds(model.panelAdds, shownOf(msg.body as WorkstreamView));
  return [panelAdds === model.panelAdds ? model : { ...model, panelAdds }, effects];
}

// The page a route opens, whatever is open in the panel beside it or where
// in a thread it opens.
const pageOf = (route: Route): Route =>
  route.page === "thread" ? { page: "thread", id: route.id } : route;

// Whether the page `route` names is the one on screen, loaded: a thread or
// workstream that didn't load, or a draft (each New thread is a new one),
// isn't.
function onScreen(model: Model, route: Route): boolean {
  if (!samePage(pageOf(model.route), pageOf(route))) return false;
  if (route.item !== undefined && route.item !== model.route.item) return false;
  if (route.page === "thread") {
    const view = model.thread?.view;
    if (!view) return false;
    const { changeSet } = route;
    return changeSet === undefined || view.changeSets.some((set) => set.id === changeSet);
  }
  if (route.page === "workstream") return model.workstream?.view != null;
  return route.page !== "new-thread";
}

// Going to the page already on screen, by a link, Needs you or a search,
// keeps it as it is: where it's scrolled, a draft, the panel. It reloads
// nothing and only scrolls to the change set the route names, if any. Back,
// Forward and the address bar still load it again (`routed`).
function staying(next: Model, effects: Effect[]): [Model, Effect[]] {
  let shown = next;
  const here = (effect: Effect): Effect[] => {
    if (effect.type !== "navigate" || effect.stay || !onScreen(next, effect.route)) return [effect];
    const { route } = effect;
    if (route.page !== "thread" || route.changeSet === undefined || !shown.thread) return [];
    // Folded, it opens first, and so does the change set it sits in.
    shown = { ...shown, thread: unfolding(shown.thread, route.changeSet) };
    return [{ type: "showChangeSet", changeSetId: route.changeSet }];
  };
  const kept = effects.flatMap(here);
  return [shown, kept];
}

function updated(model: Model, msg: Msg): [Model, Effect[]] {
  switch (msg.type) {
    case "overview": {
      if (model.overview === null) return [model, []];
      const [overview, effects] = updateOverview(model.overview, msg.msg);
      return [{ ...model, overview }, effects];
    }
    case "window": {
      if (model.window === null) return [model, []];
      const [window, effects] = updateWindow(model.window, msg.msg);
      // The page's own address follows the grouping and filters, as the
      // address bar does, so a panel opened or closed keeps them.
      const { route } = model;
      const following: Route =
        route.page === "window"
          ? {
              ...windowRoute(window),
              addTo: route.addTo,
              ...(route.item !== undefined && { item: route.item }),
            }
          : route;
      const shown = routeUrl(following) === routeUrl(route) ? route : following;
      return [
        { ...model, window, route: shown },
        [...effects, ...windowTelemetry(model.window, window)],
      ];
    }
    case "workstream": {
      if (model.workstream === null) return [model, []];
      const [workstream, effects] = updateWorkstream(model.workstream, msg.msg);
      return [{ ...model, workstream }, effects];
    }
    case "chat": {
      // The window chat's thread is the overview's only.
      if (model.route.page !== "overview") return [model, []];
      const [state, effects] = updateWindowChat(
        { chat: model.chat, thread: model.thread },
        msg.msg,
      );
      const left = msg.msg.type === "newChatClicked" ? [loadWorkstreams, loadThreads] : [];
      return [{ ...model, ...state }, [...effects, ...left]];
    }
    case "thread": {
      if (model.thread === null) return [model, []];
      const [thread, effects] = updateThread(model.thread, msg.msg);
      // Scrolling sends a message often, which mostly changes nothing.
      return [thread === model.thread ? model : { ...model, thread }, effects];
    }
    case "newThread": {
      if (model.newThread === null) return [model, []];
      const [newThread, effects] = updateNewThread(model.newThread, msg.msg);
      return [{ ...model, newThread }, effects];
    }
    case "review": {
      if (model.review === null) return [model, []];
      const [review, effects] = updateReview(model.review, msg.msg);
      return [{ ...model, review }, effects];
    }
    case "connections": {
      const [connections, effects] = updateConnections(model.connections, msg.msg);
      return [{ ...model, connections }, effects];
    }
    case "closing": {
      const [closing, effects] = updateClosing(model.closing, msg.msg);
      return [{ ...model, closing }, effects];
    }
    case "ending": {
      const [ending, effects] = updateEnding(model.ending, msg.msg);
      return [{ ...model, ending }, effects];
    }
    case "workstreamRenamed": {
      const name = msg.name.trim();
      const before = model.workstreams?.find((each) => each.id === msg.id);
      if (!name || !before || name === before.name) return [model, []];
      // The list shows the new name at once; the answer, or a reload, settles it.
      const workstreams =
        model.workstreams?.map((each) => (each.id === msg.id ? { ...each, name } : each)) ?? null;
      return [
        { ...model, workstreams },
        [post(`/api/workstreams/${msg.id}/rename`, { name }, { kind: "renamed", id: msg.id })],
      ];
    }
    case "moving": {
      const [moving, effects] = updateMoving(model.moving, msg.msg);
      // Undoing a new workstream deletes it: its page, if on screen, gives
      // way to where the item came from.
      const made = model.moving.moved?.made ? model.moving.moved : null;
      const { route } = model;
      const away: Effect[] =
        made &&
        msg.msg.type === "undoClicked" &&
        moving.undoing > 0 &&
        route.page === "workstream" &&
        route.id === made.to.id
          ? [
              {
                type: "navigate",
                route: made.item.from
                  ? { page: "workstream", id: made.item.from.id }
                  : { page: "overview" },
                replace: true,
              },
            ]
          : [];
      return [{ ...model, moving }, [...effects, ...away]];
    }
    case "panel": {
      if (model.panel === null) return [model, []];
      const [panel, effects] = updatePanel(model.panel, msg.msg);
      return [{ ...model, panel }, effects];
    }
    case "panelAdd": {
      const [panelAdds, effects] = updateAdds(model.panelAdds, msg.msg);
      return [{ ...model, panelAdds }, effects];
    }
    case "panelEdit": {
      const [panelEdits, effects] = updateEdits(model.panelEdits, msg.msg);
      return [{ ...model, panelEdits }, effects];
    }
    case "undoHeld": {
      const { by, held } = msg;
      const [workstream, removals] = model.workstream
        ? updateWorkstream(model.workstream, { type: "undoHeld", by, held })
        : [null, []];
      const [ending, ended] = updateEnding(model.ending, { type: "undoHeld", by, held });
      const [moving, moves] = updateMoving(model.moving, { type: "undoHeld", by, held });
      const [overview, made] = model.overview
        ? updateOverview(model.overview, { type: "undoHeld", by, held })
        : [null, []];
      const [panelAdds, added] = holdAdds(model.panelAdds, by, held);
      const [panelEdits, edited] = holdEdits(model.panelEdits, by, held);
      const [approved, told] = updateApproved(model.approved, { type: "undoHeld", by, held });
      const [rejected, kept] = updateRejected(model.rejected, { type: "undoHeld", by, held });
      return [
        {
          ...model,
          workstream,
          ending,
          moving,
          overview,
          panelAdds,
          panelEdits,
          approved,
          rejected,
        },
        [...removals, ...ended, ...moves, ...made, ...added, ...edited, ...told, ...kept],
      ];
    }
    case "approved": {
      const [approved, effects] = updateApproved(model.approved, msg.msg);
      return [{ ...model, approved }, effects];
    }
    case "rejected": {
      const [rejected, effects] = updateRejected(model.rejected, msg.msg);
      return [{ ...model, rejected }, effects];
    }
    case "search": {
      const [search, effects] = updateSearch(model.search, msg.msg);
      return [{ ...model, search }, effects];
    }
    case "settings": {
      const [settings, effects] = updateSettings(model.settings, msg.msg);
      return [{ ...model, settings }, effects];
    }
    case "setup": {
      const [setup, effects] = updateSetup(model.setup, msg.msg);
      return [{ ...model, setup }, effects];
    }
    // Opening the panel adds to history, so Back closes it; another item
    // takes its place.
    case "itemOpened": {
      const route = withItem(model.route, msg.id);
      if (route.item === undefined) return [model, []];
      // A link to the item folded shows it again.
      const listed = {
        ...model,
        panelList: msg.list ?? null,
        panelUnder: msg.under ?? null,
        panelFolded: false,
      };
      // The item already open stays as it is, and so does the page.
      if (model.route.item === msg.id) return [listed, []];
      const replace = model.route.item !== undefined ? { replace: true as const } : {};
      return [listed, [{ type: "navigate", route, stay: true, ...replace }]];
    }
    // Stepping takes the open item's place in history, as opening another does.
    case "panelStepped": {
      const id = model.route.item;
      const next = id === undefined ? null : stepped(model.panelList, id, msg.by);
      if (next === null) return [model, []];
      return [
        { ...model, panelUnder: null },
        [{ type: "navigate", route: withItem(model.route, next), stay: true, replace: true }],
      ];
    }
    case "panelClosed":
      if (model.route.item === undefined) return [model, []];
      return [
        model,
        [{ type: "navigate", route: withItem(model.route, null), replace: true, stay: true }],
      ];
    case "panelFolded":
      return [{ ...model, panelFolded: msg.folded }, []];
    // The window chat is the overview's, so the item goes there, still open,
    // and the chat opens beside it: the current one, or empty until the
    // first question makes it. Its composer offers the item, as it offers
    // the item open beside it anywhere (decision 0062).
    case "askAboutClicked": {
      const item = model.route.item;
      if (item === undefined || !askable(model)) return [model, []];
      const overview: Route = { page: "overview", item };
      const going: Effect[] =
        model.route.page === "overview" ? [] : [{ type: "navigate", route: overview }];
      return [
        { ...model, chat: { ...model.chat, open: true }, panelFolded: false },
        [...going, { type: "focusComposer" }, report({ name: "item.asked-about", item })],
      ];
    }
    case "sourceOpened":
      return [model, [report({ name: "item.source-opened", item: msg.id, via: msg.via })]];
    case "pivotRegrouped":
      return [model, [report({ name: "block.regrouped" })]];
    case "linkClicked":
      return [model, [{ type: "navigate", route: msg.route }]];
    // Only the panel changing leaves the page as it is; the same address
    // again loads it again.
    case "routed": {
      const [routed, effects] =
        samePage(model.route, msg.route) && model.route.item !== msg.route.item
          ? [{ ...model, route: msg.route }, []]
          : enter(model, msg.route);
      return withPanel(routed, effects);
    }
    case "streamReopened": {
      if (model.thread === null) return [model, []];
      const [thread, effects] = reconnected(model.thread);
      return [{ ...model, thread }, [...effects, loadThreads]];
    }
    case "streamed": {
      if (msg.event.type === "threads") return [model, workspaceChanged(model)];
      if (model.thread === null) return [model, []];
      // Its page says so; with no thread stream now, the page watches the rest.
      if (msg.event.type === "deleted") {
        const [thread, effects] = streamed(model.thread, msg.event);
        return [
          { ...model, thread },
          [...effects, { type: "watchThreads" }, loadThreads, loadWorkstreams],
        ];
      }
      const [thread, effects] = streamed(model.thread, msg.event);
      // Its turn starting or ending, or a change set of it moving, changes what
      // it waits on, and an end may move it between thread states. The status
      // the stream opens with covers what moved before it opened. Its workstream
      // changing, or an entry of its chat, is told to every page right after,
      // which loads the lists.
      const moved = !["entry", "workstream", "chat"].includes(msg.event.type);
      return [{ ...model, thread }, moved ? [...effects, loadThreads, loadWorkstreams] : effects];
    }
    // What each thread waits on is in both lists: the workstreams count by state.
    case "threadsMoved":
      return [model, workspaceChanged(model)];
    case "replied":
      return replied(model, msg);
  }
}

function replied(model: Model, msg: Replied): [Model, Effect[]] {
  switch (msg.tag.kind) {
    // An open item's add whose workstream changed since is checked again.
    case "workstreams": {
      if (!msg.ok) return [model, []];
      const { workstreams } = msg.body as WorkstreamsView;
      const checked = model.panel ? checkAdd(model.panelAdds, model.panel.id, workstreams) : [];
      return [{ ...model, workstreams }, checked];
    }
    // `standing` reads what it says.
    case "panelAddChecked":
      return [model, []];
    case "threads": {
      if (!msg.ok) return [model, []];
      const { threads } = msg.body as ThreadsView;
      return [{ ...model, threads }, []];
    }
    // Telemetry is best effort; the window carries on either way. So is
    // marking the overview seen.
    case "telemetry":
    case "overviewLeft":
      return [model, []];
    case "windowChat":
    case "windowChatAsked":
    case "windowChatNew": {
      // Answered after the user left the overview: the chat waits for them,
      // and loads again when they're back.
      if (model.route.page !== "overview")
        return [{ ...model, chat: { ...model.chat, asking: false, asked: null } }, []];
      const [state, effects] = windowChatReplied({ chat: model.chat, thread: model.thread }, msg);
      const made =
        msg.tag.kind === "windowChatAsked" && msg.ok ? [loadWorkstreams, loadThreads] : [];
      return [{ ...model, ...state }, [...effects, ...made]];
    }
    case "overview":
      if (model.overview === null) return [model, []];
      return [{ ...model, overview: overviewReplied(model.overview, msg) }, []];
    case "noticed":
    case "noticedChanged": {
      if (model.overview === null) return [model, []];
      const [overview, effects] = noticedReplied(model.overview, msg);
      return [{ ...model, overview }, effects];
    }
    // A workstream made from the overview, or that undone: the sidebar's
    // list shows it, or no longer does.
    case "overviewMade":
    case "overviewUnmade": {
      if (model.overview === null) return [model, msg.ok ? [loadWorkstreams] : []];
      const [overview, effects] = madeReplied(model.overview, msg);
      return [{ ...model, overview }, msg.ok ? [...effects, loadWorkstreams] : effects];
    }
    case "search": {
      const [search, effects] = searchReplied(model.search, msg);
      return [{ ...model, search }, effects];
    }
    case "settings":
    case "settingsChanged":
    case "settingsLooked":
    case "settingsUsage": {
      const [settings, effects] = settingsReplied(model.settings, msg);
      return [{ ...model, settings }, effects];
    }
    case "setup":
    case "setupCli":
    case "setupAi":
    case "setupProgress": {
      const [setup, effects] = setupReplied(model.setup, msg);
      // What Claude Code, Codex or the AI chosen changed shows in Settings
      // too, and in the ask bar: once asked, and once a command has finished.
      const ended = (key: "cli" | "codex") =>
        model.setup.view?.[key]?.running != null && setup.view?.[key]?.running == null;
      const finished = ended("cli") || ended("codex");
      const moved = msg.tag.kind === "setupCli" || msg.tag.kind === "setupAi" || finished;
      return [{ ...model, setup }, moved && msg.ok ? [...effects, loadSettings] : effects];
    }
    case "item":
    case "itemStamp": {
      if (model.panel === null) return [model, []];
      const [panel, effects] = panelReplied(model.panel, msg);
      return [{ ...model, panel }, effects];
    }
    // The workstream changed, wherever the panel was by the time it answered:
    // the sidebar's counts, and the page on screen, show it.
    // A failed Undo asks whether the add still stands.
    case "panelAdded":
    case "panelAddUndone": {
      const changed = msg.ok
        ? [loadWorkstreams, ...reloadShown(model)]
        : msg.tag.kind === "panelAddUndone"
          ? recheckAdd(msg.tag.workstreamId)
          : [];
      const [panelAdds, counting] = addsReplied(model.panelAdds, msg);
      return [{ ...model, panelAdds }, [...counting, ...changed]];
    }
    // The item changed: the panel reads it again, if it's still open, and
    // the page on screen hears from its stream.
    case "panelEdited":
    case "panelEditUndone": {
      const [panelEdits, counting, reread] = editsReplied(model.panelEdits, msg);
      const [panel, reading] =
        reread !== null && model.panel?.id === reread
          ? updatePanel(model.panel, { type: "readAgainClicked" })
          : [model.panel, []];
      return [{ ...model, panelEdits, panel }, [...counting, ...reading]];
    }
    case "markedDone":
    case "deletion":
    case "deleted":
      return closed({ ...model, closing: closingReplied(model.closing, msg) }, msg);
    // Undone, the thread's stream reloads it, and the lists hear it waits on
    // the person again.
    case "unrejected":
      return [
        { ...model, rejected: rejectedReplied(model.rejected, msg) },
        msg.ok ? [loadThreads, loadWorkstreams] : [],
      ];
    // The new workstream shows in the sidebar once the thread's page loads it.
    // One started from a draft the person has since left shows there now.
    case "threadStarted": {
      if (model.newThread?.id !== msg.tag.draft)
        return [model, msg.ok ? [loadWorkstreams, loadThreads] : []];
      const [newThread, effects] = newThreadReplied(model.newThread, msg);
      return [{ ...model, newThread }, keepingItem(model, effects)];
    }
    case "connections":
    case "connectPicked":
    case "connected":
    case "onboarded":
    case "reviewed":
    case "reviewApplied":
    case "reviewRedrawn":
    case "orielAsked":
    case "configured":
    case "configureUndone":
    case "connectionChoices":
    case "disconnected":
    case "kindSwitched":
    case "serversSync":
    case "sourceSynced": {
      const {
        model: connections,
        synced,
        effects = [],
      } = connectionsReplied(model.connections, msg);
      const next = { ...model, connections };
      return synced ? sourceSynced(next, effects) : [next, effects];
    }
    case "connectors":
      return [{ ...model, connectors: connectorsReplied(model.connectors, msg) }, []];
    case "createWorkstream":
    case "addToWorkstream": {
      if (model.window === null) return [model, []];
      const [window, effects] = updateWindow(model.window, msg);
      return [{ ...model, window }, effects];
    }
    case "workstream":
    case "workstreamChanged":
    case "restored":
    case "workstreamSynced":
    case "threadOpened": {
      if (model.workstream === null) return [model, []];
      const [workstream, replied] = workstreamReplied(model.workstream, msg);
      const effects = keepingItem(model, replied);
      const moved = msg.tag.kind === "workstreamChanged" || msg.tag.kind === "restored";
      return [{ ...model, workstream }, moved ? [...effects, loadWorkstreams] : effects];
    }
    // From its page or from a list: its page, if on screen, takes the new
    // name, and every page shows it, or, refused, the old one back. A list
    // has no notice of its own, so a refusal there says why with the
    // window's other workstream failures.
    case "renamed": {
      // Only the page on screen: one kept from before loads again on entering.
      const here = model.route.page === "workstream" && model.route.id === msg.tag.id;
      const shown = here ? model.workstream : null;
      const [workstream, effects] = shown ? workstreamReplied(shown, msg) : [null, []];
      const ending =
        msg.ok || shown ? model.ending : { ...model.ending, problem: errorOf(msg.body) };
      return [
        { ...model, workstream: workstream ?? model.workstream, ending },
        [...effects, ...workspaceChanged(model)],
      ];
    }
    // Each step of a move, and its Undo, changes a workstream: every page
    // hears it as it hears any change to the workspace.
    case "moveJoined":
    case "moveLeft":
    case "moveUndone": {
      const [moving, effects] = movingReplied(model.moving, msg);
      const next = { ...model, moving };
      return [next, msg.ok ? [...effects, ...workspaceChanged(next)] : effects];
    }
    // Its threads moved with it, so both lists load again, and its page, if
    // it is on screen and still there.
    case "ended": {
      const [ending, counting] = endingAnswered(model.ending, msg);
      const next = { ...model, ending };
      const { route } = model;
      const here = route.page === "workstream" && route.id === msg.tag.id;
      return [
        next,
        [...counting, loadWorkstreams, loadThreads, ...(here ? reloadShown(next) : [])],
      ];
    }
    // A drop changes its workstream's count wherever the user is by the time it
    // answers. Its notice goes to the workstream's page or one of its threads,
    // whichever is on screen: a workstream page's model stays after leaving it.
    case "dropped": {
      if (model.route.page === "workstream" && model.workstream !== null) {
        const [workstream, effects] = workstreamReplied(model.workstream, msg);
        return [{ ...model, workstream }, [...effects, loadWorkstreams]];
      }
      if (model.route.page !== "thread" || model.thread === null) return [model, [loadWorkstreams]];
      const [thread, effects] = threadReplied(model.thread, msg);
      return [{ ...model, thread }, [...effects, loadWorkstreams]];
    }
    // The link's page loads no connectors of its own: they come with the
    // change.
    case "reviewOpened":
    case "reviewDecided": {
      if (model.review === null) return [model, []];
      const [review, effects] = reviewReplied(model.review, msg);
      const opened = msg.tag.kind === "reviewOpened";
      const connectors = opened ? connectorsReplied(model.connectors, msg) : model.connectors;
      return [{ ...model, review, connectors }, effects];
    }
    default: {
      if (model.thread === null) return [model, []];
      const [thread, effects] = threadReplied(model.thread, msg);
      // A thread that didn't load has no stream to say when others move.
      const unwatched =
        msg.tag.kind === "thread" && msg.tag.id === model.thread.id && !msg.ok && !thread.view;
      const watching = unwatched ? [...effects, { type: "watchThreads" } as const] : effects;
      // The window chat's composer is the thread's once it has loaded: words
      // typed while it loaded, as after Ask about this, go on in it, and so
      // does what they're about.
      const { chat } = model;
      if (
        model.route.page === "overview" &&
        chat.open &&
        !model.thread.view &&
        thread.view &&
        thread.draft === ""
      )
        return [
          {
            ...model,
            chat: { ...chat, draft: "" },
            thread: { ...thread, draft: chat.draft, lookingAt: chat.lookingAt },
          },
          watching,
        ];
      return [{ ...model, thread }, watching];
    }
  }
}

// Once a thread closed from a list: every list that shows it reloads, and
// so does the page it's on. A page showing a thread or workstream that is gone
// gives way, in history too, to the workstream's page or the Done page.
function closed(model: Model, msg: Replied): [Model, Effect[]] {
  if (!msg.ok || msg.tag.kind === "deletion" || !("threadId" in msg.tag)) return [model, []];
  const { threadId } = msg.tag;
  const deleted = deletedOf(msg);
  const { route } = model;
  const lists = [loadThreads, loadWorkstreams];
  if (deleted) {
    const gone = (page: Route): Effect => ({ type: "navigate", route: page, replace: true });
    const away: Route = deleted.workstreamRemoved
      ? { page: "done" }
      : { page: "workstream", id: deleted.workstreamId };
    if (route.page === "thread" && route.id === threadId) return [model, [...lists, gone(away)]];
    if (route.page === "workstream" && route.id === deleted.workstreamId)
      return [
        model,
        deleted.workstreamRemoved
          ? [...lists, gone(away)]
          : [...lists, ...initWorkstream(route.id)[1]],
      ];
    return [model, lists];
  }
  if (route.page === "thread" && route.id === threadId && model.thread !== null)
    return [model, [...lists, refreshThread(model.thread)]];
  if (route.page === "workstream") return [model, [...lists, ...initWorkstream(route.id)[1]]];
  return [model, lists];
}

// Whether the open item's panel offers "Ask about this": not beside a
// conversation, whose composer already offers it (a thread's page, or the
// overview's window chat open), and not with no AI to ask.
export function askable(model: Model): boolean {
  const { route } = model;
  if (route.item === undefined || noAi(model.settings)) return false;
  return route.page !== "thread" && !(route.page === "overview" && model.chat.open);
}

// The workstream the page is about, which the panel's item can be added to:
// the workstream's own page, a thread's, or the window adding items to one.
// Null elsewhere, and until the page has loaded enough to name it.
export function currentWorkstream(model: Model): CurrentWorkstream | null {
  const { route } = model;
  const ids = (members: readonly { ref: { id: string } }[]) =>
    new Set(members.map((member) => member.ref.id));
  if (route.page === "workstream") {
    const view = model.workstream?.view;
    if (!view || view.workstream.id !== route.id) return null;
    const { id, name } = view.workstream;
    return { id, name, members: ids(view.members) };
  }
  if (route.page === "thread") {
    const view = model.thread?.view;
    if (!view) return null;
    const { id, name } = view.workstream;
    // Its region's items, while the region is the workstream's latest
    // version; once the workstream moved on, they may not be its own.
    const latest = view.regionVersion >= view.workstream.version;
    return { id, name, members: latest ? ids(view.members) : null };
  }
  if (route.page === "window" && route.addTo !== null) {
    const found = model.workstreams?.find((workstream) => workstream.id === route.addTo);
    return found ? { id: found.id, name: found.name, members: null } : null;
  }
  return null;
}
