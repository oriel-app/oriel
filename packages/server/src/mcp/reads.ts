// What a program reads through the MCP door is what the window reads: each
// resource is one of the window's own routes, at the same path under
// `oriel://` as under `/api/`, answered by the same handler, so the two
// can't drift. `oriel://threads/{id}` is GET /api/threads/{id}: the thread
// as its page shows it, entries, blocks, change sets and next steps. Two are
// a view of a route, as the window's sidebar draws Needs you and the Done
// page from the one list of threads. The window's event streams are the
// door's subscriptions (protocol.ts). What a program may not read, and why,
// is in parity.ts.
import { type ThreadSummaryView, waitsOnUser } from "@oriel/web/view";

export type WindowRead = {
  name: string;
  title: string;
  description: string;
  // RFC 6570: path variables, and the query a route reads as `{?…}`.
  uriTemplate: string;
  // The window's route it reads, as parity.ts names routes.
  route: string;
  // Only part of what the route answers, as the window draws it.
  pick?: (answer: unknown) => unknown;
  // Listed in `resources/list`, as one resource: it has no variables.
  listed?: true;
};

const threadsOf = (answer: unknown): ThreadSummaryView[] =>
  (answer as { threads: ThreadSummaryView[] }).threads;
const browseQuery = "q,source,status,assignee,workstream";

export const windowReads: readonly WindowRead[] = [
  {
    name: "overview",
    title: "The overview",
    description:
      "The window's overview: each workstream's card, what isn't in a workstream yet, the window chat and the pins.",
    uriTemplate: "oriel://overview",
    route: "GET /overview",
    listed: true,
  },
  {
    name: "needs-you",
    title: "Needs you",
    description:
      "The threads waiting on the user: a change set to review, an apply stalled, a held message or draft, or a reply. Only the user acts on them.",
    uriTemplate: "oriel://needs-you",
    route: "GET /threads",
    pick: (answer) => ({
      threads: threadsOf(answer).filter((thread) => waitsOnUser(thread.waitingOn)),
    }),
    listed: true,
  },
  {
    name: "done",
    title: "Done",
    description: "The threads marked done, or done by an applied change set.",
    uriTemplate: "oriel://done",
    route: "GET /threads",
    pick: (answer) => ({ threads: threadsOf(answer).filter((thread) => thread.state === "done") }),
    listed: true,
  },
  {
    name: "threads",
    title: "Threads",
    description: "Every thread, most recently active first, with its state and what it waits on.",
    uriTemplate: "oriel://threads",
    route: "GET /threads",
    listed: true,
  },
  {
    name: "thread",
    title: "A thread",
    description:
      "A thread as its page shows it: its chat entries and the agent's blocks, its change sets with their next steps, its workstream and version.",
    uriTemplate: "oriel://threads/{id}",
    route: "GET /threads/:id",
  },
  {
    name: "workstreams",
    title: "Workstreams",
    description: "Every workstream, with its size and its threads' states.",
    uriTemplate: "oriel://workstreams",
    route: "GET /workstreams",
    listed: true,
  },
  {
    name: "workstream",
    title: "A workstream",
    description:
      "A workstream as its page shows it: its items, its history with who changed it, and its threads.",
    uriTemplate: "oriel://workstreams/{id}",
    route: "GET /workstreams/:id",
  },
  {
    name: "browse",
    title: "Browse",
    description:
      "Browse's clusters under a grouping (epic, assignee, stuck or linked), with no items, and its filters.",
    uriTemplate: `oriel://browse{?grouping,${browseQuery}}`,
    route: "GET /browse",
  },
  {
    name: "browse-items",
    title: "A cluster's items",
    description: "One page of a Browse cluster's items, from `from`.",
    uriTemplate: `oriel://browse/items{?grouping,cluster,from,${browseQuery}}`,
    route: "GET /browse/items",
  },
  {
    name: "diff",
    title: "A change set's diff",
    description:
      "What a change set would write, field by field, read from its source now, as the user reviews it. Only the user approves it.",
    uriTemplate: "oriel://change-sets/{id}/diff",
    route: "POST /change-sets/:id/diff",
  },
  {
    name: "search",
    title: "Search threads",
    description: "The sidebar's search over threads and what their change sets wrote.",
    uriTemplate: "oriel://search{?q}",
    route: "GET /search",
  },
  {
    name: "item",
    title: "An item",
    description: "An item in the window, read live from its source, as its panel shows it.",
    uriTemplate: "oriel://items/{item}",
    route: "GET /items/:item",
  },
  {
    name: "item-stamp",
    title: "When an item last changed",
    description: "When the index last saw an item change.",
    uriTemplate: "oriel://items/{item}/stamp",
    route: "GET /items/:item/stamp",
  },
  {
    name: "window-chat",
    title: "The window chat",
    description: "The window chat's thread, or null before its first question.",
    uriTemplate: "oriel://window-chat",
    route: "GET /window-chat",
    listed: true,
  },
  {
    name: "noticed",
    title: "Noticed",
    description: "Noticed's cards and the pins on the overview.",
    uriTemplate: "oriel://noticed",
    route: "GET /noticed",
    listed: true,
  },
  {
    name: "connections",
    title: "Connections",
    description: "Each connection, its state and when it last synced. No secret is in it.",
    uriTemplate: "oriel://connections",
    route: "GET /connections",
    listed: true,
  },
  {
    name: "connectors",
    title: "Connectors",
    description: "The kinds of source Oriel connects to.",
    uriTemplate: "oriel://connectors",
    route: "GET /connectors",
    listed: true,
  },
];

// A template as a pattern for the URIs it names: each path variable one
// segment, and the query only the names it lists.
function pattern(template: string): { path: RegExp; query: Set<string> } {
  const [, base = template, names = ""] =
    /^([^{?]*(?:\{[a-z]+\}[^{?]*)*)(?:\{\?([a-z,-]+)\})?$/.exec(template) ?? [];
  const path = base.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[a-z]+\}/g, "([^/?#]+)");
  return { path: new RegExp(`^${path}$`), query: new Set(names.split(",").filter(Boolean)) };
}
const patterns = new Map(windowReads.map((read) => [read, pattern(read.uriTemplate)]));

// The read a URI names, and the window's path it reads, with its query;
// null when no read names it, or it asks for what its route doesn't read.
export function readOf(uri: string): { read: WindowRead; path: string; item?: string } | null {
  const url = URL.parse(uri);
  if (url?.protocol !== "oriel:") return null;
  // `oriel://threads/x`: the host is the route's first segment.
  const path = `oriel://${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  for (const [read, { path: shape, query }] of patterns) {
    const matched = shape.exec(path);
    if (!matched) continue;
    if ([...url.searchParams.keys()].some((key) => !query.has(key))) return null;
    const route = read.route.split(" ")[1] ?? "";
    // The route's own `:x`s, in order, from the URI's variables.
    let n = 1;
    const filled = route.replace(/:[a-z]+/g, () => matched[n++] ?? "");
    const item = read.uriTemplate.includes("{item}") ? decodeURIComponent(matched[1] ?? "") : null;
    return {
      read,
      path: `/api${filled}${url.search}`,
      ...(item === null ? {} : { item }),
    };
  }
  return null;
}
