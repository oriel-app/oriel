import { type GroupingId, isGroupingId, type WindowView } from "./view.ts";

// The two zoom levels inside the list: a cluster as one row (an epic row), or
// opened to its items (the story list).
export type Zoom = "cluster" | "list";

export type Model = {
  grouping: GroupingId;
  // The window last loaded. It stays on screen while another grouping loads.
  window: WindowView | null;
  status: "loading" | "ready" | "failed";
  // The latest window request. Replies to earlier ones are dropped.
  request: number;
  // Per grouping, the clusters open at the "list" zoom level.
  open: Readonly<Record<GroupingId, readonly string[]>>;
};

export type Msg =
  | { type: "groupingPicked"; grouping: GroupingId }
  | { type: "clusterToggled"; key: string }
  | { type: "zoomPicked"; zoom: Zoom }
  | { type: "retryClicked" }
  | { type: "windowLoaded"; request: number; window: WindowView }
  | { type: "windowFailed"; request: number };

export type Effect =
  | { type: "loadWindow"; request: number; grouping: GroupingId }
  // Puts the grouping in the address bar, so a reload keeps it.
  | { type: "showGrouping"; grouping: GroupingId };

// `grouping` is what the address bar asked for, if anything.
export function init(grouping: string | null): [Model, Effect[]] {
  const picked = isGroupingId(grouping) ? grouping : "epic";
  const model: Model = {
    grouping: picked,
    window: null,
    status: "loading",
    request: 0,
    open: { epic: [], assignee: [], stuck: [] },
  };
  return load(model, picked);
}

function load(model: Model, grouping: GroupingId): [Model, Effect[]] {
  const request = model.request + 1;
  return [
    { ...model, grouping, status: "loading", request },
    [{ type: "loadWindow", request, grouping }],
  ];
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
      return [{ ...model, window: msg.window, status: "ready" }, []];
    case "windowFailed":
      if (msg.request !== model.request) return [model, []];
      return [{ ...model, status: "failed" }, []];
    // Zoom acts on the window on screen, which is the old grouping's while a
    // new one loads.
    case "clusterToggled": {
      if (model.window === null) return [model, []];
      const { grouping } = model.window;
      const open = model.open[grouping];
      const next = open.includes(msg.key)
        ? open.filter((key) => key !== msg.key)
        : [...open, msg.key];
      return [{ ...model, open: { ...model.open, [grouping]: next } }, []];
    }
    case "zoomPicked": {
      if (model.window === null) return [model, []];
      const keys = msg.zoom === "list" ? model.window.clusters.map(({ row }) => row.key) : [];
      return [{ ...model, open: { ...model.open, [model.window.grouping]: keys } }, []];
    }
  }
}

export function zoomOf(model: Model, key: string): Zoom {
  if (model.window === null) return "cluster";
  return model.open[model.window.grouping].includes(key) ? "list" : "cluster";
}

// The zoom level every cluster on screen shares, or null when they differ.
export function windowZoom(model: Model): Zoom | null {
  const zooms = new Set(model.window?.clusters.map(({ row }) => zoomOf(model, row.key)));
  if (zooms.size > 1) return null;
  return zooms.has("list") ? "list" : "cluster";
}
