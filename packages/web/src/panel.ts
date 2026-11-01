// The panel beside the page: one item, read live when it opens, in its
// source's own view. Which item is open lives in the route (`item`), so an
// address can open it; this keeps the read, and when the index last saw the
// item change, which says when the read has fallen behind its source.
import { type Effect, errorOf, get, type Replied, report } from "./http.ts";
import type { ItemPanelView, ItemStampView } from "./view.ts";

export type PanelModel = {
  id: string;
  status: "loading" | "ready" | "failed";
  // The last read, kept on screen while the item is read again.
  view: ItemPanelView | null;
  // When the index last saw the item change, as asked since the read; null
  // until asked.
  changedAt: string | null;
  problem: string | null;
};

export type PanelMsg = { type: "readAgainClicked" };

const path = (id: string) => `/api/items/${encodeURIComponent(id)}`;
const read = (id: string): Effect => get(path(id), { kind: "item", id });

// Opens `id`'s panel, reading it, and says it was opened.
export function openPanel(id: string): [PanelModel, Effect[]] {
  return [
    { id, status: "loading", view: null, changedAt: null, problem: null },
    [read(id), report({ name: "item.panel-opened", item: id })],
  ];
}

export function updatePanel(model: PanelModel, msg: PanelMsg): [PanelModel, Effect[]] {
  switch (msg.type) {
    case "readAgainClicked":
      if (model.status === "loading") return [model, []];
      return [{ ...model, status: "loading", problem: null }, [read(model.id)]];
  }
}

// A reply for this panel's item; one for an item no longer open is dropped.
export function panelReplied(model: PanelModel, msg: Replied): [PanelModel, Effect[]] {
  const { tag } = msg;
  if ((tag.kind !== "item" && tag.kind !== "itemStamp") || tag.id !== model.id) return [model, []];
  if (tag.kind === "itemStamp")
    return msg.ok
      ? [{ ...model, changedAt: (msg.body as ItemStampView).updatedAt }, []]
      : [model, []];
  if (!msg.ok) return [{ ...model, status: "failed", problem: errorOf(msg.body) }, []];
  return [{ ...model, status: "ready", view: msg.body as ItemPanelView, changedAt: null }, []];
}

// Asks the index when the item last changed, without reading its source.
export function checkPanel(model: PanelModel): Effect[] {
  return model.view ? [get(`${path(model.id)}/stamp`, { kind: "itemStamp", id: model.id })] : [];
}

// Whether the item changed in its source after it was read: the index saw a
// change later than both the read and what it knew at the read. Either alone
// could mislead: the source's clock isn't Oriel's, and an index that lagged
// the read catches up to it without any change since.
export function behind(model: PanelModel): boolean {
  const { view, changedAt } = model;
  if (view === null || changedAt === null) return false;
  return changedAt > view.readAt && changedAt > (view.updatedAt ?? "");
}
