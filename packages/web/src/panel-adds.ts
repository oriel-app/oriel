// Adding the panel's item to the workstream the page is about (OA-149), and
// its Undo, which is one more note in the window's stack (OA-152): the same
// entry shows there and beside the add, so undoing either undoes both, and
// its Undo runs out as every note's does. Each add is kept whatever item the
// panel shows, so one in flight, or its Undo, can't go twice, and stepping
// away and back finds it as it was. Leaving the page lets go of its Undo, as
// of every note's; the add itself is still said beside the item.
import { type Effect, errorOf, get, post, type Replied, undoing } from "./http.ts";
import {
  type Held,
  type Hold,
  holding,
  letGo as release,
  notHeld,
  type Undos,
  undoMs,
} from "./undos.ts";
import type { Undoable, UndoView, WorkstreamView } from "./view.ts";

// One item's add to one workstream: the workstream by its name then, and the
// item's key as a person reads it, for the stack's note. What's in flight,
// the add or its Undo; once the add answered, the workstream version it made
// and the call that undoes it, null when the item was in already. `shown`:
// whether its Undo still shows. `countdown`: which of the adds' countdowns
// is its Undo's latest; only that one's end lets it go.
export type PanelAdd = {
  item: string;
  key: string;
  workstreamId: string;
  name: string;
  pending: "add" | "undo" | null;
  done: { version: number; undo: UndoView | null } | null;
  shown: boolean;
  countdown: number;
  problem: string | null;
};

// `countdowns`: how many countdowns have started, so none is mistaken for
// another, whichever add it was for.
export type PanelAdds = { adds: readonly PanelAdd[]; held: Held; countdowns: number };

export const noAdds: PanelAdds = { adds: [], held: notHeld, countdowns: 0 };

// Which add: its item, and the workstream it went to.
export type AddOf = { item: string; workstreamId: string };

export type PanelAddMsg =
  | {
      type: "addClicked";
      item: { id: string; key: string };
      workstream: { id: string; name: string };
    }
  | ({ type: "undoClicked" } & AddOf)
  | ({ type: "undoExpired"; countdown: number } & AddOf)
  | ({ type: "problemDismissed" } & AddOf);

// A workstream as a page on screen shows it: its version, and its members then.
export type ShownWorkstream = { id: string; version: number; members: ReadonlySet<string> };

const same = (add: PanelAdd, of: AddOf) =>
  add.item === of.item && add.workstreamId === of.workstreamId;

export const addOf = (adds: PanelAdds, of: AddOf): PanelAdd | null =>
  adds.adds.find((each) => same(each, of)) ?? null;

// Whether its Undo shows, in the stack and beside the add.
export const undoable = (add: PanelAdd): add is PanelAdd & { done: { undo: UndoView } } =>
  add.shown && add.done?.undo != null;

const put = (adds: PanelAdds, add: PanelAdd): PanelAdds => ({
  ...adds,
  adds: [...adds.adds.filter((each) => !same(each, add)), add],
});

const drop = (adds: PanelAdds, of: AddOf): PanelAdds => ({
  ...adds,
  adds: adds.adds.filter((each) => !same(each, of)),
});

export function updateAdds(adds: PanelAdds, msg: PanelAddMsg): [PanelAdds, Effect[]] {
  switch (msg.type) {
    // Through Oriel's action for it (workstream.add, decision 0024), as
    // adding from the window is.
    case "addClicked": {
      const { id, name } = msg.workstream;
      const of = { item: msg.item.id, workstreamId: id };
      if (addOf(adds, of)?.pending) return [adds, []];
      const add: PanelAdd = {
        ...of,
        key: msg.item.key,
        name,
        pending: "add",
        done: null,
        shown: false,
        countdown: 0,
        problem: null,
      };
      return [
        put(adds, add),
        [
          post(
            `/api/workstreams/${id}/add`,
            { items: [add.item] },
            { kind: "panelAdded", id: add.item, workstreamId: id, name },
          ),
        ],
      ];
    }
    // Through the one path every Undo takes.
    case "undoClicked": {
      const add = addOf(adds, msg);
      if (!add || add.pending || !undoable(add)) return [adds, []];
      const tag = { kind: "panelAddUndone", id: add.item, workstreamId: add.workstreamId } as const;
      return [put(adds, { ...add, pending: "undo", problem: null }), [undoing(add.done.undo, tag)]];
    }
    case "undoExpired": {
      const add = addOf(adds, msg);
      if (!add || add.countdown !== msg.countdown || add.pending || holding(adds.held))
        return [adds, []];
      return [put(adds, { ...add, shown: false }), []];
    }
    case "problemDismissed": {
      const add = addOf(adds, msg);
      return add ? [put(adds, { ...add, problem: null }), []] : [adds, []];
    }
  }
}

// Its Undo's full time, from now, on a countdown no other has had.
function counted(adds: PanelAdds, add: PanelAdd): [PanelAdds, Effect[]] {
  const countdown = adds.countdowns + 1;
  const next = { ...add, countdown };
  const { item, workstreamId } = next;
  const expiry: Effect = {
    type: "after",
    ms: undoMs,
    msg: { type: "panelAdd", msg: { type: "undoExpired", item, workstreamId, countdown } },
  };
  return [put({ ...adds, countdowns: countdown }, next), undoable(next) ? [expiry] : []];
}

// The pointer or keyboard on the stack holds every note in it; once neither
// does, each Undo gets its full time again.
export function holdAdds(adds: PanelAdds, by: Hold, held: boolean): [PanelAdds, Effect[]] {
  if (held) return [{ ...adds, held: { ...adds.held, [by]: true } }, []];
  const [left, restart] = release(adds.held, by);
  const base = { ...adds, held: left };
  if (!restart) return [base, []];
  return adds.adds
    .filter((add) => undoable(add) && !add.pending)
    .reduce<[PanelAdds, Effect[]]>(
      ([now, effects], add) => {
        const [next, more] = counted(now, add);
        return [next, [...effects, ...more]];
      },
      [base, []],
    );
}

// The answer to an add or its Undo, whichever item the panel shows by then,
// if it is the one in flight: an add shows what it did, with its Undo
// running out; an Undo that landed takes the add away; a refusal says why,
// and an Undo refused stays to try again, with its full time.
export function addsReplied(adds: PanelAdds, msg: Replied): [PanelAdds, Effect[]] {
  const { tag } = msg;
  if (tag.kind !== "panelAdded" && tag.kind !== "panelAddUndone") return [adds, []];
  const of = { item: tag.id, workstreamId: tag.workstreamId };
  const add = addOf(adds, of);
  if (add?.pending !== (tag.kind === "panelAdded" ? "add" : "undo")) return [adds, []];
  if (tag.kind === "panelAddUndone" && msg.ok) return [drop(adds, of), []];
  if (!msg.ok) {
    const failed = { ...add, pending: null, problem: errorOf(msg.body) };
    return tag.kind === "panelAddUndone" ? counted(adds, failed) : [put(adds, failed), []];
  }
  const { workstream, undo } = msg.body as Undoable<WorkstreamView>;
  return counted(adds, {
    ...add,
    pending: null,
    done: { version: workstream.version, undo },
    shown: undo !== null,
    problem: null,
  });
}

// Leaving a page: every Undo goes, as every note's does, and what went wrong
// with it; what is in flight still answers.
export const addsLeft = (adds: PanelAdds): PanelAdds => ({
  ...adds,
  adds: adds.adds.map((add) => (add.pending ? add : { ...add, shown: false, problem: null })),
  held: notHeld,
});

// The adds that still stand, by what a page shows of a workstream: one goes
// once it shows the workstream, at the version the add made or later,
// without the item, as when it was removed some other way. One it shows
// with the item at a later version stands as of that version. A page that
// shows an older version tells nothing, and neither does one shown while
// the add or its Undo is in flight: their answer does.
export function standingAdds(adds: PanelAdds, shown: ShownWorkstream): PanelAdds {
  let changed = false;
  const standing = adds.adds.flatMap((add) => {
    const { done } = add;
    if (done === null || add.pending || shown.id !== add.workstreamId) return [add];
    if (shown.version < done.version) return [add];
    if (shown.version === done.version && shown.members.has(add.item)) return [add];
    changed = true;
    return shown.members.has(add.item)
      ? [{ ...add, done: { ...done, version: shown.version } }]
      : [];
  });
  return changed ? { ...adds, adds: standing } : adds;
}

// For the open item's adds, once the workstreams list shows a workstream
// changed since its add stood: that workstream, loaded again, says whether
// it still does.
export function checkAdd(
  adds: PanelAdds,
  item: string,
  workstreams: readonly { id: string; version: number }[] | null,
): Effect[] {
  return adds.adds.flatMap((add) => {
    const listed = workstreams?.find((each) => each.id === add.workstreamId);
    const moved = add.item === item && add.done && listed && listed.version > add.done.version;
    return moved ? recheckAdd(add.workstreamId) : [];
  });
}

// An add's workstream, loaded again, as after its Undo failed: only the
// workstream says whether that was because the add no longer stands.
export const recheckAdd = (workstreamId: string): Effect[] => [
  get(`/api/workstreams/${workstreamId}`, { kind: "panelAddChecked", workstreamId }),
];

// What a workstream's view shows of it, for `standingAdds`.
export const shownOf = (view: WorkstreamView): ShownWorkstream => ({
  id: view.workstream.id,
  version: view.workstream.version,
  members: new Set(view.members.map((member) => member.ref.id)),
});

// What the add did, in a sentence beside it, where the item goes without
// saying; or null before it answers.
export function addedText(add: PanelAdd): string | null {
  if (add.done === null) return null;
  return add.done.undo ? `Added to “${add.name}”.` : `Already in “${add.name}”.`;
}

// Each add's Undo, as a note in the window's stack, which names the item;
// and the last Undo that failed, which the stack says too, wherever the
// panel is.
export function addUndos(adds: PanelAdds, send: (msg: PanelAddMsg) => void): Undos {
  const of = ({ item, workstreamId }: PanelAdd): AddOf => ({ item, workstreamId });
  const notes = adds.adds.filter(undoable).map((add) => {
    const said = `Added ${add.key} to “${add.name}”.`;
    return {
      key: `added-${add.workstreamId}-${add.item}`,
      said,
      label: `Undo: ${said}`,
      onUndo: () => send({ type: "undoClicked", ...of(add) }),
      disabled: add.pending !== null,
    };
  });
  // Until dismissed, though its Undo may run out meanwhile.
  const failed = adds.adds.findLast((add) => add.problem !== null && add.done?.undo != null);
  const problem = failed && {
    said: `Couldn't undo adding ${failed.key}: ${failed.problem}`,
    onDismiss: () => send({ type: "problemDismissed", ...of(failed) }),
  };
  return { notes, problem: problem ?? null };
}
