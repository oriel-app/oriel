// The whole app as one program: where the page is, and each page's own
// model. Pages update themselves; this routes messages and replies to them,
// and keeps the groups and threads lists the chrome shows.
import {
  type ClosingModel,
  type ClosingMsg,
  closingReplied,
  deletedOf,
  initClosing,
  updateClosing,
} from "./closing.ts";
import {
  type FolderModel,
  type FolderMsg,
  folderReplied,
  initFolder,
  loadFolder,
  updateFolder,
} from "./folder.ts";
import { type GroupModel, type GroupMsg, groupReplied, initGroup, updateGroup } from "./group.ts";
import { type Effect, get, type Replied, report } from "./http.ts";
import {
  initJira,
  type JiraModel,
  type JiraMsg,
  jiraReplied,
  loadJira,
  updateJira,
} from "./jira.ts";
import { samePage, withItem } from "./nav.ts";
import {
  checkPanel,
  openPanel,
  type PanelModel,
  type PanelMsg,
  panelReplied,
  updatePanel,
} from "./panel.ts";
import {
  initReview,
  type ReviewModel,
  type ReviewMsg,
  reviewReplied,
  updateReview,
} from "./review.ts";
import type { Route } from "./route.ts";
import {
  initNewThread,
  initThread,
  type NewThreadModel,
  type NewThreadMsg,
  newThreadReplied,
  reconnected,
  streamed,
  type ThreadModel,
  type ThreadMsg,
  threadReplied,
  updateNewThread,
  updateThread,
} from "./thread.ts";
import {
  init as initWindow,
  type Model as WindowModel,
  type Msg as WindowMsg,
  update as updateWindow,
} from "./update.ts";
import type {
  GroupsView,
  GroupSummary,
  ThreadsView,
  StreamEvent,
  ThreadSummaryView,
} from "./view.ts";

export type Model = {
  route: Route;
  window: WindowModel | null;
  group: GroupModel | null;
  thread: ThreadModel | null;
  // A thread from nothing, until its first message starts it, and how many
  // such drafts were opened, which numbers them.
  newThread: NewThreadModel | null;
  drafts: number;
  review: ReviewModel | null;
  // The connected folder, beside the groups.
  folder: FolderModel;
  // Jira, which the window offers to connect until it is, then to sync.
  jira: JiraModel;
  // For the chrome: the workspace's groups and threads.
  groups: GroupSummary[] | null;
  threads: ThreadSummaryView[] | null;
  // Threads being marked done or deleted from a list of them.
  closing: ClosingModel;
  // The item open in the panel beside the page, as the route names it.
  panel: PanelModel | null;
};

export type Msg =
  | { type: "window"; msg: WindowMsg }
  | { type: "group"; msg: GroupMsg }
  | { type: "thread"; msg: ThreadMsg }
  | { type: "newThread"; msg: NewThreadMsg }
  | { type: "review"; msg: ReviewMsg }
  | { type: "folder"; msg: FolderMsg }
  | { type: "jira"; msg: JiraMsg }
  | { type: "closing"; msg: ClosingMsg }
  | { type: "panel"; msg: PanelMsg }
  // A plain click on a link to an item: it opens in the panel.
  | { type: "itemOpened"; id: string }
  | { type: "panelClosed" }
  // The user left for an item's source: from its panel, or by a Cmd/Ctrl or
  // middle click on a link to it. The browser goes; this only tells.
  | { type: "sourceOpened"; id: string; via: "panel" | "link" }
  // A link inside the app was followed.
  | { type: "linkClicked"; route: Route }
  // The page changed: after a link, or back and forward.
  | { type: "routed"; route: Route }
  | { type: "streamed"; event: StreamEvent }
  // The thread's stream reconnected after dropping.
  | { type: "streamReopened" }
  // The workspace changed: some thread's turn started or ended, a change set
  // of one moved, or one of Oriel's own actions changed a group or thread,
  // in this tab or another.
  | { type: "threadsMoved" }
  | Replied;

// What the sidebar shows, loaded on entering any page. The groups load again
// when their counts may have moved, since the sidebar shows them beside the
// page that moved them.
const loadGroups: Effect = get("/api/groups", { kind: "groups" });
const loadThreads: Effect = get("/api/threads", { kind: "threads" });
const lists: Effect[] = [loadGroups, loadThreads, loadFolder, loadJira];

// The group or thread on screen, loaded again.
const reloadShown = (model: Model): Effect[] => {
  const { route, group, thread } = model;
  if (route.page === "group" && group)
    return [get(`/api/groups/${group.id}`, { kind: "groupSynced", id: group.id })];
  if (route.page === "thread" && thread)
    return [get(`/api/threads/${thread.id}`, { kind: "thread", id: thread.id })];
  return [];
};

// However the workspace changed, and whoever changed it, every page hears it
// the same way: the lists load again, and so does a group's page on screen.
// A thread's page hears its own thread, and its group, on its own stream.
const workspaceChanged = (model: Model): Effect[] => [
  loadThreads,
  loadGroups,
  ...(model.route.page === "group" ? reloadShown(model) : []),
];

export function init(route: Route): [Model, Effect[]] {
  const empty: Model = {
    route,
    window: null,
    group: null,
    thread: null,
    newThread: null,
    drafts: 0,
    review: null,
    folder: initFolder(),
    jira: initJira(),
    groups: null,
    threads: null,
    closing: initClosing(),
    panel: null,
  };
  return withPanel(...enter(empty, route));
}

// The panel follows the route: it opens, reading the item, when the route
// names another item, and closes when it names none.
function withPanel(model: Model, effects: Effect[]): [Model, Effect[]] {
  const { item } = model.route;
  if (item === undefined) return [{ ...model, panel: null }, effects];
  if (model.panel?.id === item) return [model, effects];
  const [panel, opened] = openPanel(item);
  return [{ ...model, panel }, [...effects, ...opened]];
}

// Sets up the page `route` names. The window keeps its state between visits,
// picked items included.
// What only the window knows happened, for pilot telemetry: the grouping
// switched, or a cluster zoomed in or out.
export function windowTelemetry(before: WindowModel, after: WindowModel): Effect[] {
  if (after.grouping !== before.grouping)
    return [report({ name: "grouping.switched", grouping: after.grouping })];
  const shown = after.window?.grouping;
  if (shown === undefined || after.open === before.open) return [];
  const was = before.open[shown].length;
  const now = after.open[shown].length;
  if (now === was) return [];
  return [
    report(
      now > was
        ? { name: "zoom.changed", from: "cluster", to: "list" }
        : { name: "zoom.changed", from: "list", to: "cluster" },
    ),
  ];
}

// A thread's page watches its events only while it is on screen: leaving
// stops watching, and entering, by a link, Back or the same link again,
// loads it fresh and watches again from its last entry.
function enter(model: Model, route: Route): [Model, Effect[]] {
  const leaving: Effect[] = model.thread ? [{ type: "unsubscribe" }] : [];
  // A thread's own stream says when any thread moves; every other page
  // watches them all. A review link's page loads on its own, watching nothing.
  const watching: Effect[] = [
    { type: route.page === "thread" ? "unwatchThreads" : "watchThreads" },
  ];
  // A draft left behind is dropped: nothing was made for it.
  const base = { ...model, route, thread: null, newThread: null };
  switch (route.page) {
    case "window": {
      if (model.window === null) {
        const [window, effects] = initWindow(route.grouping, route.addTo);
        return [{ ...base, window }, [...leaving, ...effects, ...lists, ...watching]];
      }
      const [window, effects] =
        route.grouping === model.window.grouping
          ? [model.window, []]
          : updateWindow(model.window, { type: "groupingPicked", grouping: route.grouping });
      const loads = effects.filter((effect) => effect.type === "loadWindow");
      return [
        { ...base, window: { ...window, addTo: route.addTo } },
        [...leaving, ...loads, ...lists, ...watching],
      ];
    }
    case "group": {
      const [group, effects] = initGroup(route.id);
      return [{ ...base, group }, [...leaving, ...effects, ...lists, ...watching]];
    }
    case "thread": {
      const [thread, effects] = initThread(route.id);
      return [{ ...base, thread }, [...leaving, ...effects, ...lists, ...watching]];
    }
    case "new-thread":
      return [
        { ...base, newThread: initNewThread(model.drafts + 1), drafts: model.drafts + 1 },
        [...leaving, ...lists, ...watching],
      ];
    case "done":
      return [base, [...leaving, ...lists, ...watching]];
    case "review": {
      const [review, effects] = initReview(route.token);
      return [{ ...base, review }, [...leaving, ...effects]];
    }
  }
}

// When the window or the lists load again, something may have moved in the
// index, so an open panel asks whether its item changed since its read.
export function update(model: Model, msg: Msg): [Model, Effect[]] {
  const [next, effects] = updated(model, msg);
  const moved = effects.some(
    (effect) =>
      effect.type === "loadWindow" || (effect.type === "http" && effect.tag.kind === "threads"),
  );
  return moved && next.panel ? [next, [...effects, ...checkPanel(next.panel)]] : [next, effects];
}

function updated(model: Model, msg: Msg): [Model, Effect[]] {
  switch (msg.type) {
    case "window": {
      if (model.window === null) return [model, []];
      const [window, effects] = updateWindow(model.window, msg.msg);
      return [{ ...model, window }, [...effects, ...windowTelemetry(model.window, window)]];
    }
    case "group": {
      if (model.group === null) return [model, []];
      const [group, effects] = updateGroup(model.group, msg.msg);
      return [{ ...model, group }, effects];
    }
    case "thread": {
      if (model.thread === null) return [model, []];
      const [thread, effects] = updateThread(model.thread, msg.msg);
      return [{ ...model, thread }, effects];
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
    case "folder": {
      const [folder, effects] = updateFolder(model.folder, msg.msg);
      return [{ ...model, folder }, effects];
    }
    case "jira": {
      const [jira, effects] = updateJira(model.jira, msg.msg);
      return [{ ...model, jira }, effects];
    }
    case "closing": {
      const [closing, effects] = updateClosing(model.closing, msg.msg);
      return [{ ...model, closing }, effects];
    }
    case "panel": {
      if (model.panel === null) return [model, []];
      const [panel, effects] = updatePanel(model.panel, msg.msg);
      return [{ ...model, panel }, effects];
    }
    // Opening the panel adds to history, so Back closes it; another item
    // takes its place.
    case "itemOpened": {
      const route = withItem(model.route, msg.id);
      // The item already open stays as it is, and so does the page.
      if (route.item === undefined || model.route.item === msg.id) return [model, []];
      const replace = model.route.item !== undefined ? { replace: true as const } : {};
      return [model, [{ type: "navigate", route, stay: true, ...replace }]];
    }
    case "panelClosed":
      if (model.route.item === undefined) return [model, []];
      return [
        model,
        [{ type: "navigate", route: withItem(model.route, null), replace: true, stay: true }],
      ];
    case "sourceOpened":
      return [model, [report({ name: "item.source-opened", item: msg.id, via: msg.via })]];
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
          [...effects, { type: "watchThreads" }, loadThreads, loadGroups],
        ];
      }
      const [thread, effects] = streamed(model.thread, msg.event);
      // Its turn starting or ending, or a change set of it moving, changes what
      // it waits on, and an end may move it between thread states. The status
      // the stream opens with covers what moved before it opened.
      const moved = msg.event.type !== "entry";
      return [{ ...model, thread }, moved ? [...effects, loadThreads, loadGroups] : effects];
    }
    // What each thread waits on is in both lists: the groups count by state.
    case "threadsMoved":
      return [model, workspaceChanged(model)];
    case "replied":
      return replied(model, msg);
  }
}

function replied(model: Model, msg: Replied): [Model, Effect[]] {
  switch (msg.tag.kind) {
    case "groups":
      return msg.ok ? [{ ...model, groups: (msg.body as GroupsView).groups }, []] : [model, []];
    case "threads":
      return msg.ok ? [{ ...model, threads: (msg.body as ThreadsView).threads }, []] : [model, []];
    // Telemetry is best effort; the window carries on either way.
    case "telemetry":
      return [model, []];
    case "item":
    case "itemStamp": {
      if (model.panel === null) return [model, []];
      const [panel, effects] = panelReplied(model.panel, msg);
      return [{ ...model, panel }, effects];
    }
    case "markedDone":
    case "deletion":
    case "deleted":
      return closed({ ...model, closing: closingReplied(model.closing, msg) }, msg);
    // The new group shows in the sidebar once the thread's page loads it.
    // One started from a draft the person has since left shows there now.
    case "threadStarted": {
      if (model.newThread?.id !== msg.tag.draft)
        return [model, msg.ok ? [loadGroups, loadThreads] : []];
      const [newThread, effects] = newThreadReplied(model.newThread, msg);
      return [{ ...model, newThread }, effects];
    }
    // Once the folder synced, the window shows its files.
    case "folder":
    case "folderConnected":
    case "folderSynced": {
      const { model: folder, synced } = folderReplied(model.folder, msg);
      if (!synced || model.window === null) return [{ ...model, folder }, []];
      const [window, effects] = updateWindow(model.window, { type: "retryClicked" });
      return [{ ...model, folder, window }, effects];
    }
    // Once Jira connected or synced, what's on screen shows what changed there: new items
    // in the window, and a member deleted in Jira as gone on a group's page
    // or in a thread's rail.
    case "jira":
    case "jiraConnected":
    case "jiraSynced": {
      const { model: jira, synced } = jiraReplied(model.jira, msg);
      if (!synced) return [{ ...model, jira }, []];
      const [window, effects] = model.window
        ? updateWindow(model.window, { type: "retryClicked" })
        : [null, []];
      return [{ ...model, jira, window }, [...effects, ...reloadShown(model)]];
    }
    case "createGroup":
    case "addToGroup": {
      if (model.window === null) return [model, []];
      const [window, effects] = updateWindow(model.window, msg);
      return [{ ...model, window }, effects];
    }
    case "group":
    case "groupChanged":
    case "restored":
    case "groupSynced":
    case "renamed":
    case "threadOpened": {
      if (model.group === null) return [model, []];
      const [group, effects] = groupReplied(model.group, msg);
      const moved =
        msg.tag.kind === "renamed" ||
        msg.tag.kind === "groupChanged" ||
        msg.tag.kind === "restored";
      return [{ ...model, group }, moved ? [...effects, loadGroups] : effects];
    }
    // A drop changes its group's count wherever the user is by the time it
    // answers. Its notice goes to the group's page or one of its threads,
    // whichever is on screen: a group page's model stays after leaving it.
    case "dropped": {
      if (model.route.page === "group" && model.group !== null) {
        const [group, effects] = groupReplied(model.group, msg);
        return [{ ...model, group }, [...effects, loadGroups]];
      }
      if (model.route.page !== "thread" || model.thread === null) return [model, [loadGroups]];
      const [thread, effects] = threadReplied(model.thread, msg);
      return [{ ...model, thread }, [...effects, loadGroups]];
    }
    case "reviewOpened":
    case "reviewDecided": {
      if (model.review === null) return [model, []];
      const [review, effects] = reviewReplied(model.review, msg);
      return [{ ...model, review }, effects];
    }
    default: {
      if (model.thread === null) return [model, []];
      const [thread, effects] = threadReplied(model.thread, msg);
      // A thread that didn't load has no stream to say when others move.
      const unwatched =
        msg.tag.kind === "thread" && msg.tag.id === model.thread.id && !msg.ok && !thread.view;
      return [{ ...model, thread }, unwatched ? [...effects, { type: "watchThreads" }] : effects];
    }
  }
}

// Once a thread closed from a list: every list that shows it reloads, and
// so does the page it's on. A page showing a thread or group that is gone
// gives way, in history too, to the group's page or the Done page.
function closed(model: Model, msg: Replied): [Model, Effect[]] {
  if (!msg.ok || msg.tag.kind === "deletion" || !("threadId" in msg.tag)) return [model, []];
  const { threadId } = msg.tag;
  const deleted = deletedOf(msg);
  const { route } = model;
  const lists = [loadThreads, loadGroups];
  if (deleted) {
    const gone = (page: Route): Effect => ({ type: "navigate", route: page, replace: true });
    const away: Route = deleted.groupRemoved
      ? { page: "done" }
      : { page: "group", id: deleted.groupId };
    if (route.page === "thread" && route.id === threadId) return [model, [...lists, gone(away)]];
    if (route.page === "group" && route.id === deleted.groupId)
      return [
        model,
        deleted.groupRemoved ? [...lists, gone(away)] : [...lists, ...initGroup(route.id)[1]],
      ];
    return [model, lists];
  }
  if (route.page === "thread" && route.id === threadId && model.thread !== null)
    return [model, [...lists, get(`/api/threads/${threadId}`, { kind: "thread", id: threadId })]];
  if (route.page === "group") return [model, [...lists, ...initGroup(route.id)[1]]];
  return [model, lists];
}
