import { isItemId } from "./item-id.ts";
import {
  type BrowseFilter,
  browseFilter,
  filterKeys,
  filterParams,
  type GroupingId,
  isGroupingId,
  type SettingsSection,
  settingsSections,
} from "./view.ts";

export type Route = Page & { item?: string };

export type Page =
  | { page: "overview" }
  | ({ page: "window"; grouping: GroupingId; addTo: string | null } & BrowseFilter)
  | { page: "workstream"; id: string }
  | { page: "thread"; id: string; changeSet?: string }
  | { page: "new-thread" }
  | { page: "done"; tab?: "dropped"; number?: number }
  | { page: "settings"; section: SettingsSection }
  | { page: "setup" }
  | { page: "review"; token: string };

export type { SettingsSection };

const ulid = "[0-9A-HJKMNP-TV-Z]{26}";
const workstreamPath = new RegExp(`^/workstreams/(${ulid})$`);
const threadPath = new RegExp(`^/threads/(${ulid})$`);
const reviewPath = /^\/review\/([A-Za-z0-9_-]{1,64})$/;
const ulidShape = new RegExp(`^${ulid}$`);

export function parseRoute(pathname: string, search: string): Route {
  const page = parsePage(pathname, search);
  const item = new URLSearchParams(search).get("item");
  return page.page !== "review" && item !== null && isItemId(item) ? { ...page, item } : page;
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
  if (pathname === "/setup") return { page: "setup" };
  if (pathname === "/settings") return { page: "settings", section: "providers" };
  const section = /^\/settings\/([a-z]+)$/.exec(pathname)?.[1];
  const known = settingsSections.find((each) => each !== "providers" && each === section);
  if (known) return { page: "settings", section: known };
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
  const browsing =
    pathname === "/browse" ||
    grouping !== null ||
    addTo !== null ||
    filterKeys.some((key) => query.has(key));
  if (!browsing) return { page: "overview" };
  return {
    page: "window",
    grouping: isGroupingId(grouping) ? grouping : "epic",
    addTo: addTo && ulidShape.test(addTo) ? addTo : null,
    ...browseFilter(query),
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
    case "overview":
      return "/";
    case "window": {
      const query = new URLSearchParams([["grouping", route.grouping], ...filterParams(route)]);
      if (route.addTo) query.set("addTo", route.addTo);
      return `/browse?${query}`;
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
    case "settings":
      return route.section === "providers" ? "/settings" : `/settings/${route.section}`;
    case "setup":
      return "/setup";
    case "review":
      return `/review/${route.token}`;
  }
}

export const changeSetAnchor = (changeSetId: string): string => `change-set-${changeSetId}`;

// A path inside Oriel, never another site; anything else is null.
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
