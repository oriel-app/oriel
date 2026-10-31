// The whole app as one program: where the page is, and each page's own
// model. Pages update themselves; this routes messages and replies to them,
// and keeps the groups and threads lists the chrome shows.
import {
  type FolderModel,
  type FolderMsg,
  folderReplied,
  initFolder,
  loadFolder,
  updateFolder,
} from "./folder.ts";
import { type GroupModel, type GroupMsg, groupReplied, initGroup, updateGroup } from "./group.ts";
import { type Effect, get, post, type Replied } from "./http.ts";
import {
  initReview,
  type ReviewModel,
  type ReviewMsg,
  reviewReplied,
  updateReview,
} from "./review.ts";
import type { Route } from "./route.ts";
import {
  initThread,
  reconnected,
  streamed,
  type ThreadModel,
  type ThreadMsg,
  threadReplied,
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
  InboxView,
  StreamEvent,
  ThreadSummaryView,
} from "./view.ts";

export type Model = {
  route: Route;
  window: WindowModel | null;
  group: GroupModel | null;
  thread: ThreadModel | null;
  review: ReviewModel | null;
  // The connected folder, beside the groups.
  folder: FolderModel;
  // For the chrome: the workspace's groups and threads.
  groups: GroupSummary[] | null;
  threads: ThreadSummaryView[] | null;
};

export type Msg =
  | { type: "window"; msg: WindowMsg }
  | { type: "group"; msg: GroupMsg }
  | { type: "thread"; msg: ThreadMsg }
  | { type: "review"; msg: ReviewMsg }
  | { type: "folder"; msg: FolderMsg }
  // A link inside the app was followed.
  | { type: "linkClicked"; route: Route }
  // The page changed: after a link, or back and forward.
  | { type: "routed"; route: Route }
  | { type: "streamed"; event: StreamEvent }
  // The thread's stream reconnected after dropping.
  | { type: "streamReopened" }
  // Some thread's turn started or ended, a change set of one moved, or one
  // was marked done.
  | { type: "threadsMoved" }
  | Replied;

// What the sidebar shows, loaded on entering any page. The groups load again
// when their counts may have moved, since the sidebar shows them beside the
// page that moved them.
const loadGroups: Effect = get("/api/groups", { kind: "groups" });
const loadThreads: Effect = get("/api/threads", { kind: "inbox" });
const lists: Effect[] = [loadGroups, loadThreads, loadFolder];

export function init(route: Route): [Model, Effect[]] {
  const empty: Model = {
    route,
    window: null,
    group: null,
    thread: null,
    review: null,
    folder: initFolder(),
    groups: null,
    threads: null,
  };
  return enter(empty, route);
}

// Sets up the page `route` names. The window keeps its state between visits,
// picked items included.
// What only the window knows happened, for pilot telemetry: the grouping
// switched, or a cluster zoomed in or out.
export function windowTelemetry(before: WindowModel, after: WindowModel): Effect[] {
  const report = (body: unknown): Effect => post("/api/telemetry", body, { kind: "telemetry" });
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
  const base = { ...model, route, thread: null };
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
    case "inbox":
      return [base, [...leaving, ...lists, ...watching]];
    case "review": {
      const [review, effects] = initReview(route.token);
      return [{ ...base, review }, [...leaving, ...effects]];
    }
  }
}

export function update(model: Model, msg: Msg): [Model, Effect[]] {
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
    case "review": {
      if (model.review === null) return [model, []];
      const [review, effects] = updateReview(model.review, msg.msg);
      return [{ ...model, review }, effects];
    }
    case "folder": {
      const [folder, effects] = updateFolder(model.folder, msg.msg);
      return [{ ...model, folder }, effects];
    }
    case "linkClicked":
      return [model, [{ type: "navigate", route: msg.route }]];
    case "routed":
      return enter(model, msg.route);
    case "streamReopened": {
      if (model.thread === null) return [model, []];
      const [thread, effects] = reconnected(model.thread);
      return [{ ...model, thread }, [...effects, loadThreads]];
    }
    case "streamed": {
      if (msg.event.type === "threads") return [model, [loadThreads, loadGroups]];
      if (model.thread === null) return [model, []];
      const [thread, effects] = streamed(model.thread, msg.event);
      // Its turn starting or ending, or a change set of it moving, changes what
      // it waits on, and an end may move it between inbox states. The status
      // the stream opens with covers what moved before it opened.
      const moved = msg.event.type !== "entry";
      return [{ ...model, thread }, moved ? [...effects, loadThreads, loadGroups] : effects];
    }
    // What each thread waits on is in both lists: the groups count by state.
    case "threadsMoved":
      return [model, [loadThreads, loadGroups]];
    case "replied":
      return replied(model, msg);
  }
}

function replied(model: Model, msg: Replied): [Model, Effect[]] {
  switch (msg.tag.kind) {
    case "groups":
      return msg.ok ? [{ ...model, groups: (msg.body as GroupsView).groups }, []] : [model, []];
    case "inbox":
      return msg.ok ? [{ ...model, threads: (msg.body as InboxView).threads }, []] : [model, []];
    // Telemetry is best effort; the window carries on either way.
    case "telemetry":
      return [model, []];
    // Once the folder synced, the window shows its files.
    case "folder":
    case "folderConnected":
    case "folderSynced": {
      const { model: folder, synced } = folderReplied(model.folder, msg);
      if (!synced || model.window === null) return [{ ...model, folder }, []];
      const [window, effects] = updateWindow(model.window, { type: "retryClicked" });
      return [{ ...model, folder, window }, effects];
    }
    case "createGroup":
    case "addToGroup": {
      if (model.window === null) return [model, []];
      const [window, effects] = updateWindow(model.window, msg);
      return [{ ...model, window }, effects];
    }
    case "group":
    case "groupChanged":
    case "renamed":
    case "threadOpened": {
      if (model.group === null) return [model, []];
      const [group, effects] = groupReplied(model.group, msg);
      const moved = msg.tag.kind === "renamed" || msg.tag.kind === "groupChanged";
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
      return [{ ...model, thread }, effects];
    }
  }
}
