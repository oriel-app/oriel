import { type Effect, errorOf, get, type Replied, report } from "./http.ts";
import type { ItemPanelView, ItemStampView, PanelInline } from "./view.ts";

export type PanelModel = {
  id: string;
  status: "loading" | "ready" | "failed";
  glimpse: Glimpse | null;
  view: ItemPanelView | null;
  changedAt: string | null;
  problem: string | null;
};

export type Glimpse = { key: string; title: string; status: string | null };

export const panelName = (model: PanelModel): { key: string; title: string | null } => ({
  key: model.view?.key ?? model.glimpse?.key ?? model.id.slice(model.id.indexOf(":") + 1),
  title: model.view?.title ?? model.glimpse?.title ?? null,
});

export type CurrentWorkstream = { id: string; name: string; members: ReadonlySet<string> | null };

export type PanelMsg = { type: "readAgainClicked" };

const path = (id: string) => `/api/items/${encodeURIComponent(id)}`;
const read = (id: string): Effect => get(path(id), { kind: "item", id });

export function openPanel(id: string, glimpse: Glimpse | null = null): [PanelModel, Effect[]] {
  return [
    { id, status: "loading", glimpse, view: null, changedAt: null, problem: null },
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

export function checkPanel(model: PanelModel): Effect[] {
  return model.view ? [get(`${path(model.id)}/stamp`, { kind: "itemStamp", id: model.id })] : [];
}

// Either alone could mislead: the source's clock isn't Oriel's, and an index that lagged the
// read catches up to it without any change since.
export function behind(model: PanelModel): boolean {
  const { view, changedAt } = model;
  if (view === null || changedAt === null) return false;
  return changedAt > view.readAt && changedAt > (view.updatedAt ?? "");
}

export function paragraphsOf(spans: readonly PanelInline[]): PanelInline[][] {
  const paragraphs: PanelInline[][] = [];
  let paragraph: PanelInline[] = [];
  let line: PanelInline[] = [];
  const endLine = () => {
    if (line.every((span) => span.kind === "text" && span.text.trim() === "")) {
      if (paragraph.length > 0) paragraphs.push(paragraph);
      paragraph = [];
    } else {
      if (paragraph.length > 0) paragraph.push({ kind: "break" });
      paragraph.push(...line);
    }
    line = [];
  };
  for (const span of spans) {
    if (span.kind !== "text") {
      line.push(span);
      continue;
    }
    span.text
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .forEach((words, i) => {
        if (i > 0) endLine();
        if (words !== "") line.push({ kind: "text", text: words });
      });
  }
  endLine();
  if (paragraph.length > 0) paragraphs.push(paragraph);
  return paragraphs;
}

const day = 24 * 60 * 60_000;

export function daysOf(
  messages: readonly { at: string }[],
  before: string | null,
): ({ later: number } | null)[] {
  return messages.map((message, i) => {
    const previous = i === 0 ? before : (messages[i - 1]?.at ?? null);
    if (previous !== null && dayOf(previous) === dayOf(message.at)) return null;
    // Calendar days, rounded across a change of the clocks.
    const gap = previous === null ? 0 : dayStart(message.at) - dayStart(previous);
    return { later: Math.max(0, Math.round(gap / day)) };
  });
}

export const dayOf = (instant: string): string => new Date(instant).toDateString();
const dayStart = (instant: string): number => new Date(instant).setHours(0, 0, 0, 0);

export function placeIn(
  list: readonly string[] | null,
  id: string,
): { index: number; count: number } | null {
  const index = list?.indexOf(id) ?? -1;
  return list && index >= 0 ? { index, count: list.length } : null;
}

export function stepped(list: readonly string[] | null, id: string, by: 1 | -1): string | null {
  const place = placeIn(list, id);
  return place && list ? (list[place.index + by] ?? null) : null;
}
