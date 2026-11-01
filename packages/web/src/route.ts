// Where the page is: the window (with a grouping, and maybe a group it is
// adding items to), a group, a thread, a new thread not started yet, the
// Done page (the threads no longer working, in two tabs, a page at a time),
// or a review link.
import { type GroupingId, isGroupingId } from "./view.ts";

export type Route =
  | { page: "window"; grouping: GroupingId; addTo: string | null }
  | { page: "group"; id: string }
  | { page: "thread"; id: string }
  | { page: "new-thread" }
  // `tab`: the dropped threads; absent for the done and handed-off ones.
  // `number`: the tab's page, from 1; absent for the first.
  | { page: "done"; tab?: "dropped"; number?: number }
  | { page: "review"; token: string };

const ulid = "[0-9A-HJKMNP-TV-Z]{26}";
const groupPath = new RegExp(`^/groups/(${ulid})$`);
const threadPath = new RegExp(`^/threads/(${ulid})$`);
const reviewPath = /^\/review\/([A-Za-z0-9_-]{1,64})$/;

export function parseRoute(pathname: string, search: string): Route {
  const query = new URLSearchParams(search);
  const group = groupPath.exec(pathname)?.[1];
  if (group) return { page: "group", id: group };
  const thread = threadPath.exec(pathname)?.[1];
  if (thread) return { page: "thread", id: thread };
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
    addTo: addTo && new RegExp(`^${ulid}$`).test(addTo) ? addTo : null,
  };
}

export function routeUrl(route: Route): string {
  switch (route.page) {
    case "window": {
      const query = new URLSearchParams({ grouping: route.grouping });
      if (route.addTo) query.set("addTo", route.addTo);
      return `/?${query}`;
    }
    case "group":
      return `/groups/${route.id}`;
    case "thread":
      return `/threads/${route.id}`;
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

// A link to a source, only when it is http(s): anything else renders as text.
export function safeHref(url: string | null): string | undefined {
  if (url === null) return undefined;
  return /^https?:\/\//i.test(url) ? url : undefined;
}
