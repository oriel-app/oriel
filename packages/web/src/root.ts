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
import { cameBack } from "./came-back.ts";
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
  handedOver,
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
  seenUpTo,
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

type Under = { thread: string; seq: number };

export type Model = {
  route: Route;
  overview: OverviewModel | null;
  chat: WindowChatModel;
  window: WindowModel | null;
  workstream: WorkstreamModel | null;
  thread: ThreadModel | null;
  newThread: NewThreadModel | null;
  drafts: number;
  review: ReviewModel | null;
  connections: ConnectionsModel;
  connectors: Connectors;
  workstreams: WorkstreamSummary[] | null;
  threads: ThreadSummaryView[] | null;
  closing: ClosingModel;
  ending: EndingModel;
  moving: MovingModel;
  panel: PanelModel | null;
  panelList: readonly string[] | null;
  panelUnder: Under | null;
  panelFolded: boolean;
  panelAdds: PanelAdds;
  panelEdits: PanelEdits;
  search: SearchModel;
  settings: SettingsModel;
  setup: SetupModel;
  approved: ApprovedModel;
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
  | { type: "undoHeld"; by: Hold; held: boolean }
  | { type: "search"; msg: SearchMsg }
  | { type: "settings"; msg: SettingsMsg }
  | { type: "setup"; msg: SetupMsg }
  | { type: "itemOpened"; id: string; list?: readonly string[]; under?: Under }
  | { type: "panelStepped"; by: 1 | -1 }
  | { type: "panelClosed" }
  | { type: "panelFolded"; folded: boolean }
  | { type: "askAboutClicked" }
  | { type: "sourceOpened"; id: string; via: "panel" | "link" }
  | { type: "pivotRegrouped" }
  | { type: "workstreamRenamed"; id: string; name: string }
  | { type: "linkClicked"; route: Route }
  | { type: "routed"; route: Route }
  | { type: "streamed"; event: StreamEvent }
  | { type: "streamReopened"; stream: "thread" | "threads" }
  | { type: "threadsMoved" }
  | Replied;

const loadWorkstreams: Effect = get("/api/workstreams", { kind: "workstreams" });
const loadThreads: Effect = get("/api/threads", { kind: "threads" });
const lists: Effect[] = [loadWorkstreams, loadThreads, loadConnections];

const reloadShown = (model: Model): Effect[] => {
  const { route, workstream, thread } = model;
  if (route.page === "workstream" && workstream && !deletedWorkstream(model.ending, workstream.id))
    return [
      get(`/api/workstreams/${workstream.id}`, { kind: "workstreamSynced", id: workstream.id }),
    ];
  if (route.page === "thread" && thread) return [refreshThread(thread)];
  return [];
};

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

const workspaceChanged = (model: Model): Effect[] => [
  loadThreads,
  loadWorkstreams,
  loadConnections,
  ...(model.route.page === "workstream" ? reloadShown(model) : []),
  ...(model.route.page === "overview" ? [loadOverview, loadNoticed] : []),
  ...(model.setup.view?.firstRun?.firstRun ? [loadSetup] : []),
  ...(model.thread?.view && Object.entries(model.thread.view.chips).some(oriels)
    ? [refreshThread(model.thread)]
    : []),
];

// An item's ID names its source before a `:`; Oriel's own IDs have none.
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
  const settings = route.page === "review" || route.page === "settings" ? [] : [loadSettings];
  const setup = route.page === "review" || route.page === "setup" ? [] : [loadSetup];
  const connectors = route.page === "review" ? [] : [loadConnectors];
  return withPanel(model, [...effects, ...settings, ...setup, ...connectors]);
}

function withPanel(model: Model, effects: Effect[]): [Model, Effect[]] {
  const { item } = model.route;
  if (item === undefined) return [{ ...model, panel: null, panelFolded: false }, effects];
  if (model.panel?.id === item) return [model, effects];
  const [panel, opened] = openPanel(item, glimpseOf(model, item));
  const checked = checkAdd(model.panelAdds, item, model.workstreams);
  return [{ ...model, panel, panelFolded: false }, [...effects, ...opened, ...checked]];
}

// Only the page on screen's: Browse keeps its rows between visits, which may be older than
// the page's.
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

function enter(model: Model, route: Route): [Model, Effect[]] {
  const keepsChat = onWindow(model.route) && onWindow(route) && model.thread !== null;
  const leaving: Effect[] = [
    ...(model.thread && !keepsChat ? [{ type: "unsubscribe" } as const] : []),
    ...(model.route.page === "overview" && route.page !== "overview" ? left(model.overview) : []),
  ];
  const watching: Effect[] = [
    { type: route.page === "thread" ? "unwatchThreads" : "watchThreads" },
  ];
  const chat = keepsChat ? [] : [loadWindowChat];
  const base = {
    ...model,
    route,
    chat: model.chat.hiddenOnBrowse ? { ...model.chat, hiddenOnBrowse: false } : model.chat,
    thread: keepsChat ? model.thread : null,
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
      const kept = model.overview?.view
        ? { ...overview, view: model.overview.view, noticed: model.overview.noticed }
        : overview;
      return [
        { ...base, overview: kept },
        [...leaving, ...effects, ...chat, ...lists, ...watching],
      ];
    }
    case "window": {
      if (model.window === null) {
        const [window, effects] = initWindow(route.grouping, route.addTo, route);
        return [{ ...base, window }, [...leaving, ...effects, ...chat, ...lists, ...watching]];
      }
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
        [...leaving, ...loads, ...chat, ...lists, ...watching],
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
    case "settings":
      return [base, [...leaving, loadSettings, loadUsage, loadSetup, ...lists, ...watching]];
    case "setup":
      return [base, [...leaving, loadSetup, openSetup, loadSettings, loadConnections]];
    case "review": {
      const [review, effects] = initReview(route.token);
      return [{ ...base, review }, [...leaving, ...effects]];
    }
  }
}

export function update(model: Model, msg: Msg): [Model, Effect[]] {
  const [next, effects] = focused(
    ...staying(...standing(msg, ...movedOn(model, msg, ...updated(model, msg)))),
  );
  const moved = effects.some(
    (effect) =>
      effect.type === "loadWindow" || (effect.type === "http" && effect.tag.kind === "threads"),
  );
  const latest = next.thread ? keptAtLatest(model.thread, next.thread) : [];
  const seen = next.thread && seenUpTo(next.thread);
  const shown = seen === next.thread ? next : { ...next, thread: seen };
  return [
    looking(handing(model.thread, shown)),
    [...effects, ...(moved && next.panel ? checkPanel(next.panel) : []), ...latest],
  ];
}

function handing(before: ThreadModel | null, model: Model): Model {
  if (!onWindow(model.route)) return model;
  const state = { chat: model.chat, thread: model.thread };
  const handed = handedOver(before, state);
  return handed === state ? model : { ...model, ...handed };
}

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

// Only whole views: one a page merged from more than one read, as after a rename, may pair a
// version with older members.
const wholeViews: ReadonlySet<Tag["kind"]> = new Set([
  "workstream",
  "workstreamSynced",
  "workstreamChanged",
  "panelAddChecked",
]);

function standing(msg: Msg, model: Model, effects: Effect[]): [Model, Effect[]] {
  if (msg.type !== "replied" || !msg.ok || !wholeViews.has(msg.tag.kind)) return [model, effects];
  const panelAdds = standingAdds(model.panelAdds, shownOf(msg.body as WorkstreamView));
  return [panelAdds === model.panelAdds ? model : { ...model, panelAdds }, effects];
}

const pageOf = (route: Route): Route =>
  route.page === "thread" ? { page: "thread", id: route.id } : route;

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

function staying(next: Model, effects: Effect[]): [Model, Effect[]] {
  let shown = next;
  const here = (effect: Effect): Effect[] => {
    if (effect.type !== "navigate" || effect.stay || !onScreen(next, effect.route)) return [effect];
    const { route } = effect;
    if (route.page !== "thread" || route.changeSet === undefined || !shown.thread) return [];
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
      if (!onWindow(model.route)) return [model, []];
      const [state, effects] = updateWindowChat(
        { chat: model.chat, thread: model.thread },
        msg.msg,
      );
      const left = msg.msg.type === "newChatClicked" ? [loadWorkstreams, loadThreads] : [];
      const hidden = msg.msg.type === "closeClicked" && model.route.page === "window";
      const chat = hidden ? { ...state.chat, hiddenOnBrowse: true } : state.chat;
      return [{ ...model, ...state, chat }, [...effects, ...left]];
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
      const workstreams =
        model.workstreams?.map((each) => (each.id === msg.id ? { ...each, name } : each)) ?? null;
      return [
        { ...model, workstreams },
        [post(`/api/workstreams/${msg.id}/rename`, { name }, { kind: "renamed", id: msg.id })],
      ];
    }
    case "moving": {
      const [moving, effects] = updateMoving(model.moving, msg.msg);
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
    case "itemOpened": {
      const route = withItem(model.route, msg.id);
      if (route.item === undefined) return [model, []];
      const listed = {
        ...model,
        panelList: msg.list ?? null,
        panelUnder: msg.under ?? null,
        panelFolded: false,
      };
      if (model.route.item === msg.id) return [listed, []];
      const replace = model.route.item !== undefined ? { replace: true as const } : {};
      return [listed, [{ type: "navigate", route, stay: true, ...replace }]];
    }
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
    case "askAboutClicked": {
      const item = model.route.item;
      if (item === undefined || !askable(model)) return [model, []];
      const overview: Route = { page: "overview", item };
      const going: Effect[] = onWindow(model.route) ? [] : [{ type: "navigate", route: overview }];
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
    case "routed": {
      const [routed, effects] =
        samePage(model.route, msg.route) && model.route.item !== msg.route.item
          ? [{ ...model, route: msg.route }, []]
          : enter(model, msg.route);
      return withPanel(routed, effects);
    }
    case "streamReopened": {
      const [back, reading] = cameBack(model);
      if (msg.stream === "thread") {
        if (back.thread === null) return [back, reading];
        const [thread, effects] = reconnected(back.thread);
        return [{ ...back, thread }, [...reading, ...effects, loadThreads]];
      }
      const [window, loading] = back.window
        ? updateWindow(back.window, { type: "retryClicked" })
        : [null, []];
      const page =
        back.route.page === "settings"
          ? [loadSettings, loadUsage, loadSetup]
          : back.route.page === "overview"
            ? [loadWindowChat]
            : [];
      return [{ ...back, window }, [...reading, ...loading, ...page, ...workspaceChanged(back)]];
    }
    case "streamed": {
      if (msg.event.type === "threads") return [model, workspaceChanged(model)];
      if (model.thread === null) return [model, []];
      if (msg.event.type === "deleted") {
        const [thread, effects] = streamed(model.thread, msg.event);
        return [
          { ...model, thread },
          [...effects, { type: "watchThreads" }, loadThreads, loadWorkstreams],
        ];
      }
      const [thread, effects] = streamed(model.thread, msg.event);
      // The status the stream opens with covers what moved before it opened. Its workstream or chat
      // changing reaches every page right after, which loads the lists.
      const moved = !["entry", "workstream", "chat"].includes(msg.event.type);
      return [{ ...model, thread }, moved ? [...effects, loadThreads, loadWorkstreams] : effects];
    }
    case "threadsMoved":
      return [model, workspaceChanged(model)];
    case "replied":
      return replied(model, msg);
  }
}

function replied(model: Model, msg: Replied): [Model, Effect[]] {
  switch (msg.tag.kind) {
    case "workstreams": {
      if (!msg.ok) return [model, []];
      const { workstreams } = msg.body as WorkstreamsView;
      const checked = model.panel ? checkAdd(model.panelAdds, model.panel.id, workstreams) : [];
      return [{ ...model, workstreams }, checked];
    }
    case "panelAddChecked":
      return [model, []];
    case "threads": {
      if (!msg.ok) return [model, []];
      const { threads } = msg.body as ThreadsView;
      return [{ ...model, threads }, []];
    }
    case "telemetry":
    case "overviewLeft":
      return [model, []];
    case "windowChat":
    case "windowChatAsked":
    case "windowChatNew":
    case "windowChatOpened": {
      if (!onWindow(model.route))
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
    case "unrejected":
      return [
        { ...model, rejected: rejectedReplied(model.rejected, msg) },
        msg.ok ? [loadThreads, loadWorkstreams] : [],
      ];
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
    case "moveJoined":
    case "moveLeft":
    case "moveUndone": {
      const [moving, effects] = movingReplied(model.moving, msg);
      const next = { ...model, moving };
      return [next, msg.ok ? [...effects, ...workspaceChanged(next)] : effects];
    }
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
    // A workstream page's model stays after leaving it, so the route decides where the notice goes.
    case "dropped": {
      if (model.route.page === "workstream" && model.workstream !== null) {
        const [workstream, effects] = workstreamReplied(model.workstream, msg);
        return [{ ...model, workstream }, [...effects, loadWorkstreams]];
      }
      if (model.route.page !== "thread" || model.thread === null) return [model, [loadWorkstreams]];
      const [thread, effects] = threadReplied(model.thread, msg);
      return [{ ...model, thread }, [...effects, loadWorkstreams]];
    }
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
      if (msg.tag.kind === "continued" && msg.ok && onWindow(model.route))
        return [{ ...model, thread, chat: { ...model.chat, open: false } }, effects];
      // A thread that didn't load has no stream to say when others move.
      const unwatched =
        msg.tag.kind === "thread" && msg.tag.id === model.thread.id && !msg.ok && !thread.view;
      const watching = unwatched ? [...effects, { type: "watchThreads" } as const] : effects;
      const { chat } = model;
      if (
        onWindow(model.route) &&
        chat.open &&
        !model.thread.view &&
        thread.view?.windowChat &&
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

export function askable(model: Model): boolean {
  const { route } = model;
  if (route.item === undefined || noAi(model.settings)) return false;
  if (route.page === "thread" || route.page === "new-thread") return false;
  return !(onWindow(route) && model.chat.open);
}

export const onWindow = (route: Route): boolean =>
  route.page === "overview" || route.page === "window";

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
    // Once the workstream moved on past its region's version, the region's items may not be its own.
    const latest = view.regionVersion >= view.workstream.version;
    return { id, name, members: latest ? ids(view.members) : null };
  }
  if (route.page === "window" && route.addTo !== null) {
    const found = model.workstreams?.find((workstream) => workstream.id === route.addTo);
    return found ? { id: found.id, name: found.name, members: null } : null;
  }
  return null;
}
