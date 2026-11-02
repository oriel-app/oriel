// The panel beside the page: one item, read live when it opens, in its
// source's own view. Which item is open lives in the route (`item`), so an
// address can open it; this keeps the read, and when the index last saw the
// item change, which says when the read has fallen behind its source. From
// it, the item can be added to the workstream the page is about, with Undo.
import { type Effect, errorOf, get, post, type Replied, report, undoing } from "./http.ts";
import type {
  ItemPanelView,
  ItemStampView,
  PanelInline,
  Undoable,
  UndoView,
  WorkstreamView,
} from "./view.ts";

export type PanelModel = {
  id: string;
  status: "loading" | "ready" | "failed";
  // The last read, kept on screen while the item is read again.
  view: ItemPanelView | null;
  // When the index last saw the item change, as asked since the read; null
  // until asked.
  changedAt: string | null;
  problem: string | null;
  // Adding the item to the current workstream, once the user has.
  add?: PanelAdd;
};

// Whether adding is in flight, what came of it, and what went wrong when it
// failed.
export type PanelAdd = { adding: boolean; added: Added | null; problem: string | null };

// The item went into a workstream, by its name then, with the call that
// undoes it; null when it was in already, and nothing was added.
export type Added = { workstreamId: string; name: string; undo: UndoView | null };

// The adds the panel made that can still be undone, one for each item, with
// the workstream version each made. They outlast the panel moving on, so an
// item's line and its Undo come back with it (decision 0024).
export type PanelAdds = readonly { id: string; version: number; added: Added }[];

// A workstream as a page on screen shows it: its version, and its members then.
export type ShownWorkstream = { id: string; version: number; members: ReadonlySet<string> };

// The workstream the page is about, which the panel's item can be added to:
// the workstream's page, a thread's, or the window adding to one. `members`,
// when the page knows them.
export type CurrentWorkstream = { id: string; name: string; members: ReadonlySet<string> | null };

export type PanelMsg =
  | { type: "readAgainClicked" }
  | { type: "addClicked"; workstream: { id: string; name: string } }
  | { type: "addUndoClicked" };

const path = (id: string) => `/api/items/${encodeURIComponent(id)}`;
const read = (id: string): Effect => get(path(id), { kind: "item", id });

// Opens `id`'s panel, reading it, and says it was opened. An add of it the
// panel made before, which can still be undone, shows again.
export function openPanel(id: string, adds: PanelAdds = []): [PanelModel, Effect[]] {
  const kept = adds.find((each) => each.id === id);
  return [
    {
      id,
      status: "loading",
      view: null,
      changedAt: null,
      problem: null,
      ...(kept ? { add: { adding: false, added: kept.added, problem: null } } : {}),
    },
    [read(id), report({ name: "item.panel-opened", item: id })],
  ];
}

export function updatePanel(model: PanelModel, msg: PanelMsg): [PanelModel, Effect[]] {
  switch (msg.type) {
    case "readAgainClicked":
      if (model.status === "loading") return [model, []];
      return [{ ...model, status: "loading", problem: null }, [read(model.id)]];
    // Through Oriel's action for it (workstream.add, decision 0024), as
    // adding from the window is.
    case "addClicked": {
      if (model.add?.adding) return [model, []];
      const { id, name } = msg.workstream;
      return [
        { ...model, add: { adding: true, added: model.add?.added ?? null, problem: null } },
        [
          post(
            `/api/workstreams/${id}/add`,
            { items: [model.id] },
            { kind: "panelAdded", id: model.id, workstreamId: id, name },
          ),
        ],
      ];
    }
    // Through the one path every Undo takes.
    case "addUndoClicked": {
      const { add } = model;
      if (!add || add.adding || !add.added?.undo) return [model, []];
      return [
        { ...model, add: { ...add, adding: true, problem: null } },
        [undoing(add.added.undo, { kind: "panelAddUndone", id: model.id })],
      ];
    }
  }
}

// A reply for this panel's item; one for an item no longer open is dropped.
export function panelReplied(model: PanelModel, msg: Replied): [PanelModel, Effect[]] {
  const { tag } = msg;
  if (tag.kind === "panelAdded" || tag.kind === "panelAddUndone") {
    if (tag.id !== model.id) return [model, []];
    const was = model.add?.added ?? null;
    if (!msg.ok)
      return [{ ...model, add: { adding: false, added: was, problem: errorOf(msg.body) } }, []];
    const added: Added | null =
      tag.kind === "panelAdded"
        ? {
            workstreamId: tag.workstreamId,
            name: tag.name,
            undo: (msg.body as Undoable<object>).undo,
          }
        : null;
    return [{ ...model, add: { adding: false, added, problem: null } }, []];
  }
  if ((tag.kind !== "item" && tag.kind !== "itemStamp") || tag.id !== model.id) return [model, []];
  if (tag.kind === "itemStamp")
    return msg.ok
      ? [{ ...model, changedAt: (msg.body as ItemStampView).updatedAt }, []]
      : [model, []];
  if (!msg.ok) return [{ ...model, status: "failed", problem: errorOf(msg.body) }, []];
  return [{ ...model, status: "ready", view: msg.body as ItemPanelView, changedAt: null }, []];
}

// The adds kept after a reply from adding or undoing, whichever item the
// panel shows by then: an add that can be undone is kept, in place of the
// item's last; one undone goes.
export function keptAdds(adds: PanelAdds, msg: Replied): PanelAdds {
  const { tag } = msg;
  if ((tag.kind !== "panelAdded" && tag.kind !== "panelAddUndone") || !msg.ok) return adds;
  const others = adds.filter((each) => each.id !== tag.id);
  if (tag.kind === "panelAddUndone") return others;
  const { workstream, undo } = msg.body as Undoable<WorkstreamView>;
  if (undo === null) return adds;
  const added = { workstreamId: tag.workstreamId, name: tag.name, undo };
  return [...others, { id: tag.id, version: workstream.version, added }];
}

// The adds that still stand, by what a page shows of a workstream: one goes
// once it shows the workstream, at the version the add made or later,
// without the item, as when it was removed some other way. One it shows
// with the item at a later version stands as of that version. A page that
// shows an older version tells nothing.
export function standingAdds(adds: PanelAdds, shown: readonly ShownWorkstream[]): PanelAdds {
  let changed = false;
  const standing = adds.flatMap((add) => {
    const seen = shown.find(
      (workstream) => workstream.id === add.added.workstreamId && workstream.version >= add.version,
    );
    if (!seen || (seen.version === add.version && seen.members.has(add.id))) return [add];
    changed = true;
    return seen.members.has(add.id) ? [{ ...add, version: seen.version }] : [];
  });
  return changed ? standing : adds;
}

// For the open item's add, once the workstreams list shows its workstream
// changed since the add stood: that workstream, loaded again, says whether
// it still does.
export function checkAdd(
  adds: PanelAdds,
  id: string,
  workstreams: readonly { id: string; version: number }[] | null,
): Effect[] {
  const add = adds.find((each) => each.id === id);
  const listed = add && workstreams?.find((each) => each.id === add.added.workstreamId);
  return add && listed && listed.version > add.version ? recheckAdd(adds, id) : [];
}

// An item's add's workstream, loaded again, as after its Undo failed: only
// the workstream says whether that was because the add no longer stands.
export function recheckAdd(adds: PanelAdds, id: string): Effect[] {
  const workstreamId = adds.find((each) => each.id === id)?.added.workstreamId;
  return workstreamId
    ? [get(`/api/workstreams/${workstreamId}`, { kind: "panelAddChecked", workstreamId })]
    : [];
}

// What a workstream's view shows of it, for `standingAdds`.
export const shownOf = (view: WorkstreamView): ShownWorkstream => ({
  id: view.workstream.id,
  version: view.workstream.version,
  members: new Set(view.members.map((member) => member.ref.id)),
});

// The panel without an add that no longer stands.
export function withAdds(model: PanelModel, adds: PanelAdds): PanelModel {
  const { add } = model;
  const added = add?.added;
  if (!add || !added?.undo) return model;
  const stands = adds.some(
    (each) => each.id === model.id && each.added.workstreamId === added.workstreamId,
  );
  if (stands) return model;
  return { ...model, add: { ...add, added: null } };
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

// Text as written, in paragraphs: a blank line parts them, and each other
// line break stays a break. A span that isn't text, such as a mention, sits
// in its line.
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

// Where a conversation's day changes, which gets a header, and how many whole
// days passed since the message before, for one picked up later. `before`:
// when the message above these was, in a block above.
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

// An instant's day in the reader's zone, and when that day began.
export const dayOf = (instant: string): string => new Date(instant).toDateString();
const dayStart = (instant: string): number => new Date(instant).setHours(0, 0, 0, 0);

// Where the open item is in the list it was opened from, if it was opened
// from one that still holds it.
export function placeIn(
  list: readonly string[] | null,
  id: string,
): { index: number; count: number } | null {
  const index = list?.indexOf(id) ?? -1;
  return list && index >= 0 ? { index, count: list.length } : null;
}

// The item before or after the open one in its list; none past either end.
// The list is the rows that were on the page when the item opened: a list
// that loads in pages steps through what had loaded, and stops at its end.
export function stepped(list: readonly string[] | null, id: string, by: 1 | -1): string | null {
  const place = placeIn(list, id);
  return place && list ? (list[place.index + by] ?? null) : null;
}
