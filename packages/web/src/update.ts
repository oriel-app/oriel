import { type Effect, errorOf, post, type Replied, report } from "./http.ts";
import type { Route } from "./route.ts";
import { pauseMs } from "./search.ts";
import {
  type BrowseFilter,
  type ClusterPageView,
  type ClusterView,
  filtered,
  filterFrom,
  type GroupingId,
  isGroupingId,
  listSize,
  sameFilter,
  type WorkstreamSummary,
  type WindowView,
} from "./view.ts";

export type { Effect } from "./http.ts";

export type Model = {
  grouping: GroupingId;
  // `shownFilter` is what the window on screen was loaded with; it differs from `filter` while
  // another loads.
  filter: BrowseFilter;
  shownFilter: BrowseFilter;
  query: string;
  typed: number;
  searched: boolean;
  window: WindowView | null;
  status: "loading" | "ready" | "failed";
  // Replies to earlier window requests are dropped.
  request: number;
  open: Readonly<Record<GroupingId, readonly string[]>>;
  paging: Readonly<Record<string, number | "failed">>;
  pageRequest: number;
  // By cluster, which of its item lists its first page came from, so a later
  // page from another, after the index moved, isn't put after it.
  listed: Readonly<Record<string, string>>;
  selected: readonly string[];
  picks: Readonly<Record<string, Picked>>;
  addTo: string | null;
  pending: boolean;
  notice: string | null;
};

export type Msg =
  | { type: "groupingPicked"; grouping: GroupingId }
  | { type: "clusterToggled"; key: string }
  | { type: "retryClicked" }
  | { type: "windowLoaded"; request: number; window: WindowView }
  | { type: "windowFailed"; request: number }
  | { type: "moreClicked"; key: string }
  | { type: "itemsLoaded"; request: number; page: ClusterPageView }
  | { type: "itemsFailed"; request: number; key: string; from: number }
  | { type: "queryTyped"; text: string }
  | { type: "queryPaused"; typed: number }
  | { type: "filterPicked"; filter: BrowseFilter }
  | { type: "filtersCleared" }
  | { type: "filterRouted"; filter: BrowseFilter }
  | { type: "itemToggled"; id: string }
  | { type: "selectionCleared" }
  | { type: "clusterToWorkstream"; key: string }
  | { type: "selectionToWorkstream"; name: string }
  | { type: "selectionAdded"; workstreamId: string }
  | Replied;

export function init(
  grouping: string | null,
  addTo: string | null = null,
  filter: BrowseFilter = {},
): [Model, Effect[]] {
  const picked = isGroupingId(grouping) ? grouping : "epic";
  const shown = filterFrom(filter);
  const model: Model = {
    grouping: picked,
    filter: shown,
    shownFilter: shown,
    query: shown.q ?? "",
    typed: 0,
    searched: shown.q !== undefined,
    window: null,
    status: "loading",
    request: 0,
    open: { epic: [], assignee: [], stuck: [], linked: [] },
    paging: {},
    pageRequest: 0,
    listed: {},
    selected: [],
    picks: {},
    addTo,
    pending: false,
    notice: null,
  };
  return load(model, picked);
}

function more(model: Model, key: string): [Model, Effect[]] {
  const cluster = model.window?.clusters.find((each) => each.row.key === key);
  if (!model.window || !cluster || typeof model.paging[key] === "number") return [model, []];
  if (!sameFilter(model.shownFilter, model.filter)) return [model, []];
  if (cluster.list.length >= listSize(cluster)) return [model, []];
  const request = model.pageRequest + 1;
  const { grouping } = model.window;
  return [
    { ...model, pageRequest: request, paging: { ...model.paging, [key]: request } },
    [pageOf(model, { request, grouping, cluster: key, from: cluster.list.length })],
  ];
}

function pageOf(
  model: Model,
  page: { request: number; grouping: GroupingId; cluster: string; from: number },
): Effect {
  return { type: "loadItems", ...page, ...(filtered(model.filter) && { filter: model.filter }) };
}

const revealed = 10;

function shown(model: Model, window: WindowView): [Model, Effect[]] {
  const counted: Effect[] = model.searched
    ? [
        report({
          name: "items.searched",
          queryLength: [...(model.filter.q ?? "")].length,
          results: window.items,
        }),
      ]
    : [];
  const matching = window.clusters
    .filter((cluster) => listSize(cluster) > 0)
    .slice(0, revealed)
    .map(({ row }) => row.key);
  const opened = model.searched
    ? {
        ...model.open,
        [window.grouping]: [...new Set([...model.open[window.grouping], ...matching])],
      }
    : model.open;
  const open = opened[window.grouping].filter((key) =>
    window.clusters.some((cluster) => cluster.row.key === key && listSize(cluster) > 0),
  );
  const ready = {
    ...model,
    window,
    status: "ready" as const,
    paging: {},
    listed: {},
    open: opened,
    searched: false,
    shownFilter: model.filter,
  };
  if (open.length === 0) return [ready, counted];
  const same =
    model.window?.grouping === window.grouping && sameFilter(model.shownFilter, model.filter);
  const before = same && model.window ? model.window.clusters : [];
  const kept = {
    ...window,
    clusters: window.clusters.map((cluster) => {
      const list = before.find(({ row }) => row.key === cluster.row.key)?.list;
      return list && open.includes(cluster.row.key) ? { ...cluster, list } : cluster;
    }),
  };
  let next: Model = { ...ready, window: kept };
  const effects: Effect[] = [];
  for (const key of open) {
    const request = next.pageRequest + 1;
    next = { ...next, pageRequest: request, paging: { ...next.paging, [key]: request } };
    effects.push(pageOf(next, { request, grouping: window.grouping, cluster: key, from: 0 }));
  }
  return [next, [...counted, ...effects]];
}

// A total that differs from the cluster's count, or a later page from another list than the
// first's, means the index moved since, so the window loads again.
function paged(model: Model, page: ClusterPageView): [Model, Effect[]] {
  const { window } = model;
  const cluster = window?.clusters.find(({ row }) => row.key === page.cluster);
  if (!window || !cluster) return [model, []];
  const paging = { ...model.paging };
  delete paging[page.cluster];
  const moved =
    page.total !== listSize(cluster) || (page.from > 0 && model.listed[page.cluster] !== page.of);
  if (moved) return load({ ...model, paging }, model.grouping);
  const listed = page.from === 0 ? { ...model.listed, [page.cluster]: page.of } : model.listed;
  const had = new Set(page.from === 0 ? [] : cluster.list.map((item) => item.id));
  const list = [
    ...(page.from === 0 ? [] : cluster.list),
    ...page.items.filter((item) => !had.has(item.id)),
  ];
  const clusters = window.clusters.map((each) => (each === cluster ? { ...each, list } : each));
  const locations = { ...window.locations, ...page.locations };
  return [{ ...model, paging, listed, window: { ...window, clusters, locations } }, []];
}

function load(model: Model, grouping: GroupingId): [Model, Effect[]] {
  const request = model.request + 1;
  const { filter } = model;
  return [
    { ...model, grouping, status: "loading", request },
    [{ type: "loadWindow", request, grouping, ...(filtered(filter) && { filter }) }],
  ];
}

function refilter(model: Model, filter: BrowseFilter, address: boolean): [Model, Effect[]] {
  if (sameFilter(filter, model.filter)) return [model, []];
  const searched = filter.q !== undefined && (model.searched || filter.q !== model.filter.q);
  const [next, effects] = load({ ...model, filter, searched }, model.grouping);
  return [next, address ? [...effects, { type: "showFilter", filter }] : effects];
}

export function update(model: Model, msg: Msg): [Model, Effect[]] {
  switch (msg.type) {
    case "groupingPicked": {
      if (msg.grouping === model.grouping) return [model, []];
      const [next, effects] = load(model, msg.grouping);
      return [next, [...effects, { type: "showGrouping", grouping: msg.grouping }]];
    }
    case "retryClicked":
      return load(model, model.grouping);
    case "windowLoaded":
      if (msg.request !== model.request) return [model, []];
      return shown(model, msg.window);
    case "windowFailed":
      if (msg.request !== model.request) return [model, []];
      return [{ ...model, status: "failed" }, []];
    // A toggle acts on the window on screen, which is the old grouping's while a
    // new one loads.
    case "clusterToggled": {
      if (model.window === null) return [model, []];
      const { grouping } = model.window;
      const open = model.open[grouping];
      const next = open.includes(msg.key)
        ? open.filter((key) => key !== msg.key)
        : [...open, msg.key];
      const toggled = { ...model, open: { ...model.open, [grouping]: next } };
      const empty = model.window.clusters.some(
        ({ row, list }) => row.key === msg.key && list.length === 0,
      );
      return next.includes(msg.key) && empty ? more(toggled, msg.key) : [toggled, []];
    }
    case "moreClicked":
      return more(model, msg.key);
    case "itemsLoaded": {
      const { page } = msg;
      if (model.paging[page.cluster] !== msg.request) return [model, []];
      if (model.window?.grouping !== page.grouping) return [model, []];
      return paged(model, page);
    }
    case "itemsFailed": {
      if (model.paging[msg.key] !== msg.request) return [model, []];
      const paging = { ...model.paging, [msg.key]: "failed" as const };
      const clusters = model.window?.clusters.map((cluster) =>
        msg.from === 0 && cluster.row.key === msg.key ? { ...cluster, list: [] } : cluster,
      );
      const window = model.window && clusters ? { ...model.window, clusters } : model.window;
      return [{ ...model, paging, window }, []];
    }
    case "queryTyped": {
      const typed = model.typed + 1;
      const next = { ...model, query: msg.text, typed };
      if (msg.text.trim() === "")
        return refilter(next, filterFrom({ ...model.filter, q: "" }), true);
      const paused = { type: "window", msg: { type: "queryPaused", typed } } as const;
      return [next, [{ type: "after", ms: pauseMs, msg: paused }]];
    }
    case "queryPaused":
      if (msg.typed !== model.typed) return [model, []];
      return refilter(model, filterFrom({ ...model.filter, q: model.query }), true);
    case "filterPicked":
      return refilter({ ...model, query: msg.filter.q ?? "" }, filterFrom(msg.filter), true);
    case "filtersCleared":
      return refilter({ ...model, query: "", typed: model.typed + 1 }, {}, true);
    case "filterRouted": {
      const filter = filterFrom(msg.filter);
      if (sameFilter(filter, model.filter)) return [model, []];
      return refilter({ ...model, query: filter.q ?? "", typed: model.typed + 1 }, filter, false);
    }
    case "itemToggled": {
      if (model.selected.includes(msg.id)) {
        const picks = { ...model.picks };
        delete picks[msg.id];
        const selected = model.selected.filter((id) => id !== msg.id);
        return [{ ...model, selected, picks, notice: null }, []];
      }
      const seen = pickedFrom(model.window, msg.id);
      const picks = seen ? { ...model.picks, [msg.id]: seen } : model.picks;
      return [{ ...model, selected: [...model.selected, msg.id], picks, notice: null }, []];
    }
    case "selectionCleared":
      return [{ ...model, selected: [], picks: {}, notice: null }, []];
    case "clusterToWorkstream": {
      if (model.pending || model.window === null) return [model, []];
      const body = { kind: "cluster", grouping: model.window.grouping, cluster: msg.key };
      return [
        { ...model, pending: true, notice: null },
        [post("/api/workstreams", body, { kind: "createWorkstream" })],
      ];
    }
    case "selectionToWorkstream": {
      if (model.pending || model.selected.length === 0) return [model, []];
      const body = { kind: "picked", name: msg.name, items: model.selected };
      return [
        { ...model, pending: true, notice: null },
        [post("/api/workstreams", body, { kind: "createWorkstream" })],
      ];
    }
    case "selectionAdded": {
      if (model.pending || model.selected.length === 0) return [model, []];
      return [
        { ...model, pending: true, notice: null },
        [
          post(
            `/api/workstreams/${msg.workstreamId}/add`,
            { items: model.selected },
            { kind: "addToWorkstream", workstreamId: msg.workstreamId },
          ),
        ],
      ];
    }
    case "replied": {
      const { tag } = msg;
      if (tag.kind !== "createWorkstream" && tag.kind !== "addToWorkstream") return [model, []];
      if (!msg.ok) return [{ ...model, pending: false, notice: errorOf(msg.body) }, []];
      const id =
        tag.kind === "addToWorkstream" ? tag.workstreamId : (msg.body as WorkstreamSummary).id;
      return [
        { ...model, pending: false, selected: [], picks: {}, addTo: null },
        [{ type: "navigate", route: { page: "workstream", id } }],
      ];
    }
  }
}

export function windowRoute(model: Model | null): Extract<Route, { page: "window" }> {
  return {
    page: "window",
    grouping: model?.grouping ?? "epic",
    addTo: null,
    ...(model ? model.filter : {}),
  };
}

export function isOpen(model: Model, key: string): boolean {
  return model.window !== null && model.open[model.window.grouping].includes(key);
}

export function pickedName(model: Model): string {
  const { selected } = model;
  const seen = selected.map((id): Picked | null => {
    const now = pickedFrom(model.window, id);
    const then = model.picks[id];
    if (!now && !then) return null;
    return {
      title: now?.title ?? then?.title ?? null,
      epics: now?.epics.length ? now.epics : (then?.epics ?? []),
    };
  });
  const [first] = seen;
  const epic = first?.epics.find((each) =>
    seen.every((item) => item?.epics.some((other) => other.key === each.key)),
  );
  if (epic && selected.length > 1) return cut(epic.label, maxNameChars);
  const title = first?.title ?? null;
  if (title !== null && selected.length === 1) return oneItemName(title);
  const more = ` and ${selected.length - 1} more`;
  if (title !== null) return `${cut(title, maxNameChars - more.length)}${more}`;
  return selected.length === 1 ? "1 item" : `${selected.length} items`;
}

export type Picked = { title: string | null; epics: { key: string; label: string }[] };

function pickedFrom(window: WindowView | null, id: string): Picked | null {
  const clusters = window?.clusters ?? [];
  const rows = ({ row, list }: ClusterView) => (row.anchor ? [row.anchor, ...list] : list);
  const title =
    clusters.flatMap(rows).find((row) => row.id === id && row.title.trim() !== "")?.title ?? null;
  const epics = clusters
    .filter((cluster) => cluster.row.anchor !== null && rows(cluster).some((row) => row.id === id))
    .map(({ row }) => ({ key: row.key, label: row.label }));
  return title === null && epics.length === 0 ? null : { title, epics };
}

// The server's cap.
export const maxNameChars = 120;

export const oneItemName = (title: string): string => cut(title, maxNameChars);

const cut = (text: string, max: number): string => {
  const chars = [...text.trim()];
  return chars.length <= max ? chars.join("") : `${chars.slice(0, max - 1).join("")}…`;
};
