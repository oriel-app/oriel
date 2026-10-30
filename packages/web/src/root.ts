// The whole app as one program: where the page is, and each page's own
// model. Pages update themselves; this routes messages and replies to them,
// and keeps the groups and threads lists the chrome shows.
import { type GroupModel, type GroupMsg, groupReplied, initGroup, updateGroup } from "./group.ts";
import { type Effect, get, type Replied } from "./http.ts";
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
  // For the chrome: the workspace's groups and threads.
  groups: GroupSummary[] | null;
  threads: ThreadSummaryView[] | null;
};

export type Msg =
  | { type: "window"; msg: WindowMsg }
  | { type: "group"; msg: GroupMsg }
  | { type: "thread"; msg: ThreadMsg }
  | { type: "review"; msg: ReviewMsg }
  // A link inside the app was followed.
  | { type: "linkClicked"; route: Route }
  // The page changed: after a link, or back and forward.
  | { type: "routed"; route: Route }
  | { type: "streamed"; event: StreamEvent }
  | Replied;

const lists: Effect[] = [
  get("/api/groups", { kind: "groups" }),
  get("/api/threads", { kind: "inbox" }),
];

export function init(route: Route): [Model, Effect[]] {
  const empty: Model = {
    route,
    window: null,
    group: null,
    thread: null,
    review: null,
    groups: null,
    threads: null,
  };
  return enter(empty, route);
}

// Sets up the page `route` names. The window keeps its state between visits,
// picked items included.
function enter(model: Model, route: Route): [Model, Effect[]] {
  const leaving: Effect[] =
    model.thread && route.page !== "thread" ? [{ type: "unsubscribe" }] : [];
  const base = { ...model, route };
  switch (route.page) {
    case "window": {
      if (model.window === null) {
        const [window, effects] = initWindow(route.grouping, route.addTo);
        return [{ ...base, window }, [...leaving, ...effects, ...lists]];
      }
      const [window, effects] =
        route.grouping === model.window.grouping
          ? [model.window, []]
          : updateWindow(model.window, { type: "groupingPicked", grouping: route.grouping });
      const loads = effects.filter((effect) => effect.type === "loadWindow");
      return [
        { ...base, window: { ...window, addTo: route.addTo } },
        [...leaving, ...loads, ...lists],
      ];
    }
    case "group": {
      const [group, effects] = initGroup(route.id);
      return [{ ...base, group }, [...leaving, ...effects, ...lists]];
    }
    case "thread": {
      if (model.thread?.id === route.id) return [base, []];
      const [thread, effects] = initThread(route.id);
      const swap: Effect[] = model.thread ? [{ type: "unsubscribe" }] : [];
      return [{ ...base, thread }, [...swap, ...effects, ...lists]];
    }
    case "inbox":
      return [base, [...leaving, ...lists]];
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
      return [{ ...model, window }, effects];
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
    case "linkClicked":
      return [model, [{ type: "navigate", route: msg.route }]];
    case "routed":
      return enter(model, msg.route);
    case "streamed": {
      if (model.thread === null) return [model, []];
      const [thread, effects] = streamed(model.thread, msg.event);
      // A turn that ends may have moved the thread between inbox states.
      const ended = msg.event.type === "status" && !msg.event.running;
      return [
        { ...model, thread },
        ended ? [...effects, get("/api/threads", { kind: "inbox" })] : effects,
      ];
    }
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
      const lists: Effect[] =
        msg.tag.kind === "renamed" ? [get("/api/groups", { kind: "groups" })] : [];
      return [{ ...model, group }, [...effects, ...lists]];
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
