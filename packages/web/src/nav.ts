import type { Model } from "./root.ts";
import { type Route, routeUrl } from "./route.ts";
import { expected } from "./thread.ts";
import {
  type WorkstreamSummary,
  holding,
  type ThreadStateId,
  type ThreadSummaryView,
  type WaitingOn,
  waitingOn,
  waitsOnUser,
} from "./view.ts";

export type NavWorkstream = {
  workstream: WorkstreamSummary;
  threads: ThreadSummaryView[];
  current: boolean;
};

export type Nav = {
  workstreams: NavWorkstream[] | null;
  done: WorkstreamSummary[];
  thread: string | null;
  doneTab: DoneTab | null;
  waiting: ThreadSummaryView[];
  needsYou: number;
  finished: ThreadSummaryView[];
};

export function nav(model: Model): Nav {
  const { route } = model;
  const thread = route.page === "thread" ? route.id : null;
  const workstream =
    route.page === "workstream"
      ? route.id
      : thread === null
        ? null
        : (model.thread?.view?.workstream.id ??
          model.threads?.find((summary) => summary.id === thread)?.workstream.id ??
          null);
  const threads = newestFirst(model);
  const waiting = threads.filter(needsYou);
  return {
    workstreams:
      model.workstreams
        ?.filter((summary) => summary.done === null)
        .map((summary) => ({
          workstream: summary,
          threads: threads.filter((each) => each.workstream.id === summary.id).sort(byLabel),
          current: summary.id === workstream,
        })) ?? null,
    done: (model.workstreams ?? [])
      .filter((summary) => summary.done !== null)
      .toSorted((a, b) => (b.done?.at ?? "").localeCompare(a.done?.at ?? "")),
    thread,
    doneTab: route.page === "done" ? doneTab(route) : null,
    waiting,
    needsYou: waiting.length,
    finished: threads.filter((each) => each.state !== "working"),
  };
}

const newestFirst = (model: Model): ThreadSummaryView[] =>
  [...(model.threads ?? [])]
    .sort((a, b) => b.activityAt.localeCompare(a.activityAt))
    .map(decided(model));

const labelOrder: Record<WaitingOn | ThreadStateId, number> = {
  review: 0,
  held: 1,
  draft: 2,
  reply: 3,
  stalled: 4,
  agent: 5,
  apply: 6,
  working: 7,
  "handed-off": 8,
  done: 9,
  dropped: 10,
};
const rank = (thread: ThreadSummaryView) => labelOrder[thread.waitingOn ?? thread.state];

export const byLabel = (a: ThreadSummaryView, b: ThreadSummaryView): number =>
  rank(a) - rank(b) || b.activityAt.localeCompare(a.activityAt);

const needsYou = (thread: ThreadSummaryView): boolean => waitsOnUser(thread.waitingOn);

export function nextNeedingYou(
  waiting: readonly ThreadSummaryView[],
  left: string,
): ThreadSummaryView | null {
  const others = waiting.filter((thread) => thread.id !== left);
  return others.find((thread) => thread.waitingOn === "review") ?? others[0] ?? null;
}

function decided(model: Model): (summary: ThreadSummaryView) => ThreadSummaryView {
  const { thread } = model;
  const ahead = thread && Object.keys(thread.deciding).length > 0 ? expected(thread) : null;
  if (thread === null || ahead === null) return (summary) => summary;
  return (summary) =>
    summary.id === thread.id && summary.waitingOn === "review"
      ? {
          ...summary,
          waitingOn: waitingOn({
            ...ahead,
            held: holding(ahead.entries),
            windowChat: ahead.windowChat === true,
          }),
        }
      : summary;
}

export type DoneTab = "done" | "dropped";

export function doneTab(route: Extract<Route, { page: "done" }>): DoneTab {
  return route.tab ?? "done";
}

export function doneRoute(tab: DoneTab, number = 1): Route {
  return {
    page: "done",
    ...(tab === "dropped" && { tab }),
    ...(number > 1 && { number }),
  };
}

export function doneTabs(finished: readonly ThreadSummaryView[]): {
  done: ThreadSummaryView[];
  dropped: ThreadSummaryView[];
} {
  return {
    done: finished.filter((each) => each.state !== "dropped"),
    dropped: finished.filter((each) => each.state === "dropped"),
  };
}

export const perPage = 50;

export type DonePage = {
  threads: ThreadSummaryView[];
  number: number;
  pages: number;
  total: number;
};

export function donePage(threads: readonly ThreadSummaryView[], number: number): DonePage {
  const pages = Math.max(1, Math.ceil(threads.length / perPage));
  const at = Math.min(Math.max(1, Math.trunc(number) || 1), pages);
  return {
    threads: threads.slice((at - 1) * perPage, at * perPage),
    number: at,
    pages,
    total: threads.length,
  };
}

export function doneShown(
  finished: readonly ThreadSummaryView[],
  at: { tab?: DoneTab; number?: number },
): {
  counts: { done: number; dropped: number };
  page: DonePage;
  previous: Route | null;
  next: Route | null;
} {
  const tabs = doneTabs(finished);
  const tab = at.tab ?? "done";
  const page = donePage(tabs[tab], at.number ?? 1);
  const to = (number: number) => doneRoute(tab, number);
  return {
    counts: { done: tabs.done.length, dropped: tabs.dropped.length },
    page,
    previous: page.number > 1 ? to(page.number - 1) : null,
    next: page.number < page.pages ? to(page.number + 1) : null,
  };
}

export function workstreamThreads(model: Model, workstreamId: string): ThreadSummaryView[] {
  if (model.threads === null) return (model.workstream?.view?.threads ?? []).toSorted(byLabel);
  return newestFirst(model)
    .filter((each) => each.workstream.id === workstreamId)
    .sort(byLabel);
}

export type ClickTo = "page" | "new-tab" | "browser";

export function clickTo(click: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): ClickTo {
  if (click.altKey) return "browser";
  if (click.button === 1) return "new-tab";
  if (click.button !== 0) return "browser";
  return click.metaKey || click.ctrlKey || click.shiftKey ? "new-tab" : "page";
}

export function withItem(route: Route, item: string | null): Route {
  const page = { ...route };
  delete page.item;
  return item === null || page.page === "review" ? page : { ...page, item };
}

export function samePage(a: Route, b: Route): boolean {
  return routeUrl(withItem(a, null)) === routeUrl(withItem(b, null));
}
