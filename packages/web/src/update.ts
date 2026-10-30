// The window: clusters under a grouping, at two zoom levels, and the items
// the user picks to make or grow a group.
import { type Effect, errorOf, post, type Replied } from "./http.ts";
import { type GroupingId, isGroupingId, type GroupSummary, type WindowView } from "./view.ts";

export type { Effect } from "./http.ts";

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
  // Items picked by hand, in the order picked. They stay picked across
  // groupings, since an item is the same item under any lens.
  selected: readonly string[];
  // The group the user is adding items to, from its page; null otherwise.
  addTo: string | null;
  // A group being made or grown.
  pending: boolean;
  notice: string | null;
};

export type Msg =
  | { type: "groupingPicked"; grouping: GroupingId }
  | { type: "clusterToggled"; key: string }
  | { type: "retryClicked" }
  | { type: "windowLoaded"; request: number; window: WindowView }
  | { type: "windowFailed"; request: number }
  | { type: "itemToggled"; id: string }
  | { type: "selectionCleared" }
  // Turns a cluster into a group: a copy of its members now.
  | { type: "clusterGrouped"; key: string }
  | { type: "selectionGrouped"; name: string }
  | { type: "selectionAdded"; groupId: string }
  | Replied;

// `grouping` is what the address bar asked for, if anything.
export function init(grouping: string | null, addTo: string | null = null): [Model, Effect[]] {
  const picked = isGroupingId(grouping) ? grouping : "epic";
  const model: Model = {
    grouping: picked,
    window: null,
    status: "loading",
    request: 0,
    open: { epic: [], assignee: [], stuck: [] },
    selected: [],
    addTo,
    pending: false,
    notice: null,
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
    case "itemToggled": {
      const selected = model.selected.includes(msg.id)
        ? model.selected.filter((id) => id !== msg.id)
        : [...model.selected, msg.id];
      return [{ ...model, selected, notice: null }, []];
    }
    case "selectionCleared":
      return [{ ...model, selected: [], notice: null }, []];
    case "clusterGrouped": {
      if (model.pending || model.window === null) return [model, []];
      const body = { kind: "cluster", grouping: model.window.grouping, cluster: msg.key };
      return [
        { ...model, pending: true, notice: null },
        [post("/api/groups", body, { kind: "createGroup" })],
      ];
    }
    case "selectionGrouped": {
      if (model.pending || model.selected.length === 0) return [model, []];
      const body = { kind: "picked", name: msg.name, items: model.selected };
      return [
        { ...model, pending: true, notice: null },
        [post("/api/groups", body, { kind: "createGroup" })],
      ];
    }
    case "selectionAdded": {
      if (model.pending || model.selected.length === 0) return [model, []];
      return [
        { ...model, pending: true, notice: null },
        [
          post(
            `/api/groups/${msg.groupId}/add`,
            { items: model.selected },
            { kind: "addToGroup", groupId: msg.groupId },
          ),
        ],
      ];
    }
    case "replied": {
      const { tag } = msg;
      if (tag.kind !== "createGroup" && tag.kind !== "addToGroup") return [model, []];
      if (!msg.ok) return [{ ...model, pending: false, notice: errorOf(msg.body) }, []];
      const id = tag.kind === "addToGroup" ? tag.groupId : (msg.body as GroupSummary).id;
      return [
        { ...model, pending: false, selected: [], addTo: null },
        [{ type: "navigate", route: { page: "group", id } }],
      ];
    }
  }
}

export function zoomOf(model: Model, key: string): Zoom {
  if (model.window === null) return "cluster";
  return model.open[model.window.grouping].includes(key) ? "list" : "cluster";
}

// A name for a group of hand-picked items: the cluster they all came from,
// if they did, else how many there are.
export function pickedName(model: Model): string {
  const clusters = model.window?.clusters ?? [];
  const home = clusters.find(({ list }) =>
    model.selected.every((id) => list.some((item) => item.id === id)),
  );
  if (home && model.selected.length > 1) return home.row.label;
  if (model.selected.length === 1) {
    const id = model.selected[0];
    const item = clusters.flatMap(({ list }) => list).find((row) => row.id === id);
    if (item) return item.title.slice(0, 120);
  }
  return `${model.selected.length} items`;
}
