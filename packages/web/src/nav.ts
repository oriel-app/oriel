// What the sidebar shows, from the lists the app already keeps: the threads
// waiting on the user, the user's groups, each with its threads, most
// recently active first, the finished threads, and where the page is among
// them.
// The Done page and a group's page read the same list, so all three move
// together.
import type { Model } from "./root.ts";
import { type Route, routeUrl } from "./route.ts";
import { expected } from "./thread.ts";
import { type GroupSummary, type ThreadSummaryView, waitingOn } from "./view.ts";

export type NavGroup = {
  group: GroupSummary;
  threads: ThreadSummaryView[];
  // The page is this group, or one of its threads.
  current: boolean;
};

export type Nav = {
  // Null until the groups have loaded.
  groups: NavGroup[] | null;
  // The thread on the page, if one is.
  thread: string | null;
  // The Done page's tab, if the Done page is on the page.
  doneTab: DoneTab | null;
  // Threads waiting on the user: a change set to review, or a reply. Empty
  // until the threads have loaded.
  waiting: ThreadSummaryView[];
  needsYou: number;
  // Threads no longer working: done, handed off or dropped, most recently
  // active first. The Done page lists them in its two tabs, and the sidebar's
  // Done section the first tab's, so with Needs you and the groups every
  // state stays in sight. Empty until the threads have loaded.
  finished: ThreadSummaryView[];
};

export function nav(model: Model): Nav {
  const { route } = model;
  const thread = route.page === "thread" ? route.id : null;
  // A thread's group is known from the list before the thread itself loads.
  const group =
    route.page === "group"
      ? route.id
      : thread === null
        ? null
        : (model.thread?.view?.group.id ??
          model.threads?.find((summary) => summary.id === thread)?.group.id ??
          null);
  const threads = [...(model.threads ?? [])]
    .sort((a, b) => b.activityAt.localeCompare(a.activityAt))
    .map(decided(model));
  const waiting = threads.filter(
    (each) => each.waitingOn === "review" || each.waitingOn === "reply",
  );
  return {
    groups:
      model.groups?.map((summary) => ({
        group: summary,
        threads: threads.filter((each) => each.group.id === summary.id),
        current: summary.id === group,
      })) ?? null,
    thread,
    doneTab: route.page === "done" ? doneTab(route) : null,
    waiting,
    needsYou: waiting.length,
    finished: threads.filter((each) => each.state !== "working"),
  };
}

// A decision sent from the thread's page shows in every list at once: while
// the list still has the thread needing a review, it waits on what the
// decision will leave it waiting on. So Approve and apply takes it out of
// Needs you as applying, and Reject leaves it there only if it still needs
// the user. Whatever the server says next stands, as does a failure, which
// puts it back.
function decided(model: Model): (summary: ThreadSummaryView) => ThreadSummaryView {
  const { thread } = model;
  const ahead = thread && Object.keys(thread.deciding).length > 0 ? expected(thread) : null;
  if (thread === null || ahead === null) return (summary) => summary;
  return (summary) =>
    summary.id === thread.id && summary.waitingOn === "review"
      ? { ...summary, waitingOn: waitingOn(ahead) }
      : summary;
}

// The Done page's two tabs. Done holds handed-off threads too: neither needs
// anything more from the user. Dropped holds the threads nobody settled, kept
// apart so finished work doesn't bury one the user may come back to.
export type DoneTab = "done" | "dropped";

// The tab the Done page opens on at its address: Dropped when the address
// asks for it, and otherwise Done.
export function doneTab(route: Extract<Route, { page: "done" }>): DoneTab {
  return route.tab ?? "done";
}

// The address of a page of a Done page tab. Done's carries no tab, and a
// first page no number.
export function doneRoute(tab: DoneTab, number = 1): Route {
  return {
    page: "done",
    ...(tab === "dropped" && { tab }),
    ...(number > 1 && { number }),
  };
}

// The finished threads, in the Done page's tabs.
export function doneTabs(finished: readonly ThreadSummaryView[]): {
  done: ThreadSummaryView[];
  dropped: ThreadSummaryView[];
} {
  return {
    done: finished.filter((each) => each.state !== "dropped"),
    dropped: finished.filter((each) => each.state === "dropped"),
  };
}

// The Done page shows this many threads at a time, in either tab.
export const perPage = 50;

export type DonePage = {
  threads: ThreadSummaryView[];
  // This page's number, from 1, and how many there are: at least 1, so an
  // empty page still says where it is.
  number: number;
  pages: number;
  total: number;
};

// One page of a tab's threads. A number past either end shows the nearest
// page, so an address kept from before threads were deleted still shows some.
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

// What the Done page shows at its address: the tab's threads, a page of
// them, how many each tab has, and where Previous and Next go, which keep the
// tab.
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

// A group's threads, newest first, from the list the sidebar keeps, so a new
// thread or one finishing shows on the group's page as it does there. Until
// that list loads, the group's own.
export function groupThreads(model: Model, groupId: string): ThreadSummaryView[] {
  if (model.threads === null) return model.group?.view?.threads ?? [];
  return model.threads.filter((each) => each.group.id === groupId);
}

// Where a click on a link goes: a plain click stays in the page, as an
// in-app link or an item's panel; a Cmd/Ctrl, Shift or middle click goes to a
// new tab or window, as any link's does; any other button, or Alt, is the
// browser's own. One rule for every link, so every surface agrees.
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

// The page `route` names, with `item` open in the panel beside it, or with
// none. A review link's page has no panel.
export function withItem(route: Route, item: string | null): Route {
  const page = { ...route };
  delete page.item;
  return item === null || page.page === "review" ? page : { ...page, item };
}

// Whether two routes name the same page, whatever is open in the panel.
export function samePage(a: Route, b: Route): boolean {
  return routeUrl(withItem(a, null)) === routeUrl(withItem(b, null));
}
