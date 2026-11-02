// Where the page is: the window (with a grouping, and maybe a workstream it is
// adding items to), a workstream, a thread, a new thread not started yet, the
// Done page (the threads no longer working, in two tabs, a page at a time),
// or a review link. A thread's address may name one of its change sets, to
// open the thread there. On any page but a review link's, `item` is the item open
// in the panel beside it, by its ID.
import { type GroupingId, isGroupingId } from "./view.ts";

export type Route = Page & { item?: string };

export type Page =
  | { page: "window"; grouping: GroupingId; addTo: string | null }
  | { page: "workstream"; id: string }
  | { page: "thread"; id: string; changeSet?: string }
  | { page: "new-thread" }
  // `tab`: the dropped threads; absent for the done and handed-off ones.
  // `number`: the tab's page, from 1; absent for the first.
  | { page: "done"; tab?: "dropped"; number?: number }
  | { page: "review"; token: string };

const ulid = "[0-9A-HJKMNP-TV-Z]{26}";
const workstreamPath = new RegExp(`^/workstreams/(${ulid})$`);
const threadPath = new RegExp(`^/threads/(${ulid})$`);
const reviewPath = /^\/review\/([A-Za-z0-9_-]{1,64})$/;
const ulidShape = new RegExp(`^${ulid}$`);

// An item ID's shape, loosely: the server checks each source's key.
const itemShape = /^[a-z]+:[^\s/]{1,500}$/;

export function parseRoute(pathname: string, search: string): Route {
  const page = parsePage(pathname, search);
  const item = new URLSearchParams(search).get("item");
  return page.page !== "review" && item !== null && itemShape.test(item) ? { ...page, item } : page;
}

function parsePage(pathname: string, search: string): Page {
  const query = new URLSearchParams(search);
  const workstream = workstreamPath.exec(pathname)?.[1];
  if (workstream) return { page: "workstream", id: workstream };
  const thread = threadPath.exec(pathname)?.[1];
  if (thread) {
    const changeSet = query.get("changeSet");
    return changeSet !== null && ulidShape.test(changeSet)
      ? { page: "thread", id: thread, changeSet }
      : { page: "thread", id: thread };
  }
  const token = reviewPath.exec(pathname)?.[1];
  if (token) return { page: "review", token };
  if (pathname === "/threads/new") return { page: "new-thread" };
  if (pathname === "/done") {
    const number = Number(query.get("page"));
    return {
      page: "done",
      ...(query.get("tab") === "dropped" && { tab: "dropped" as const }),
      ...(Number.isSafeInteger(number) && number > 1 && { number }),
    };
  }
  const grouping = query.get("grouping");
  const addTo = query.get("addTo");
  return {
    page: "window",
    grouping: isGroupingId(grouping) ? grouping : "epic",
    addTo: addTo && ulidShape.test(addTo) ? addTo : null,
  };
}

export function routeUrl(route: Route): string {
  const url = pageUrl(route);
  if (route.item === undefined || route.page === "review") return url;
  const item = new URLSearchParams({ item: route.item });
  return `${url}${url.includes("?") ? "&" : "?"}${item}`;
}

function pageUrl(route: Page): string {
  switch (route.page) {
    case "window": {
      const query = new URLSearchParams({ grouping: route.grouping });
      if (route.addTo) query.set("addTo", route.addTo);
      return `/?${query}`;
    }
    case "workstream":
      return `/workstreams/${route.id}`;
    case "thread":
      return route.changeSet
        ? `/threads/${route.id}?${new URLSearchParams({ changeSet: route.changeSet })}`
        : `/threads/${route.id}`;
    case "new-thread":
      return "/threads/new";
    case "done": {
      const query = new URLSearchParams();
      if (route.tab) query.set("tab", route.tab);
      if (route.number && route.number > 1) query.set("page", String(route.number));
      return `${query}` ? `/done?${query}` : "/done";
    }
    case "review":
      return `/review/${route.token}`;
  }
}

// The element a change set's block is on a thread's page, which the page
// scrolls to when its address names that change set.
export const changeSetAnchor = (changeSetId: string): string => `change-set-${changeSetId}`;

// A thread's page, or a change set on one, at an address inside Oriel, as a
// reply links to it: a path, never another site. Anything else is null.
export function inAppRoute(target: string): Route | null {
  if (!target.startsWith("/threads/")) return null;
  const url = URL.parse(target, "http://oriel.invalid");
  if (url === null || url.origin !== "http://oriel.invalid") return null;
  const route = parseRoute(url.pathname, url.search);
  return route.page === "thread" ? route : null;
}

// A link to a source, only when it is http(s): anything else renders as text.
export function safeHref(url: string | null): string | undefined {
  if (url === null) return undefined;
  return /^https?:\/\//i.test(url) ? url : undefined;
}
