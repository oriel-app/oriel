// Moving an item to another workstream: dragged from a workstream's page or
// Browse onto a workstream in the sidebar, or onto the Workstreams heading
// for a new one, or chosen from the item's row's menu. A move is the two
// actions Oriel already has, in turn: the item joins the workstream it goes
// to (workstream.add, or workstream.create for a new one), then leaves the
// one it came from (workstream.remove), so the change log, the region-version
// marker and telemetry hear of it as they do of any add and removal. An item
// from Browse came from no workstream, and only joins. What it did shows as
// one note in the window's stack, whose Undo sends back both calls the server
// gave, and runs out as every note does.
// A thread never changes workstream: it goes on in a new thread there.
import { type Effect, errorOf, post, type Replied, undoing } from "./http.ts";
import type { Msg } from "./root.ts";
import {
  expiry,
  type Held,
  type Hold,
  hold,
  notHeld,
  restart,
  runsOut,
  type Undos,
} from "./undos.ts";
import { oneItemName } from "./update.ts";
import type { ContinuedView, Undoable, UndoView, WorkstreamSummary } from "./view.ts";

// A workstream, by its ID and its name as the window showed it then.
export type Place = { id: string; name: string };

// The item being moved: its ID, its key and title as a person reads them,
// and the workstream it came from, null when it came from none.
export type CarriedItem = {
  kind: "item";
  id: string;
  key: string;
  title: string | null;
  from: Place | null;
};
export type CarriedThread = { kind: "thread"; id: string; title: string | null; from: Place };
export type Carried = CarriedItem | CarriedThread;

// What a move did: what moved, where it went, whether that workstream was
// made for it, and the calls that undo it, the join's first.
export type Move = { item: Carried; to: Place; made: boolean; undos: UndoView[] };

const named = (carried: Carried): string =>
  carried.kind === "item" ? carried.key : `“${carried.title ?? "New thread"}”`;

export type MovingModel = {
  // Dropped on the Workstreams heading: the menu that asks whether to make a
  // new workstream of it, open where the pointer let go.
  asking: { item: CarriedItem; at: { x: number; y: number } } | null;
  // A move in flight: the item and where it goes, null for a new workstream,
  // and, once it has joined, where it went and the call that undoes that.
  pending: { item: Carried; to: Place | null; joined: Place | null; undo: UndoView | null } | null;
  // How many of a move's Undo calls are still to answer.
  undoing: number;
  moved: Move | null;
  // Whether it still shows, with its Undo.
  shown: boolean;
  // The times its countdown started; only the latest one's end hides it.
  countdown: number;
  held: Held;
  // What last failed, until dismissed.
  problem: string | null;
};

export type MovingMsg =
  | { type: "dropped"; item: Carried; to: Place }
  | { type: "droppedOnHeading"; item: CarriedItem; at: { x: number; y: number } }
  // Make a new workstream of it: from the heading's menu, or the row's.
  | { type: "newClicked"; item: CarriedItem }
  | { type: "askCancelled" }
  | { type: "undoClicked" }
  | { type: "undoHeld"; by: Hold; held: boolean }
  | { type: "undoExpired"; countdown: number }
  | { type: "problemDismissed" };

export const initMoving = (): MovingModel => ({
  asking: null,
  pending: null,
  undoing: 0,
  moved: null,
  shown: false,
  countdown: 0,
  held: notHeld,
  problem: null,
});

// Whether a drop of `item` on `to` would move it: not onto where it came from.
export const movesTo = (item: Carried, to: string): boolean => item.from?.id !== to;

// One at a time, a move or its Undo, so no answer is taken for another's.
const busy = (model: MovingModel): boolean => model.pending !== null || model.undoing > 0;

export function updateMoving(model: MovingModel, msg: MovingMsg): [MovingModel, Effect[]] {
  switch (msg.type) {
    case "dropped": {
      const { item, to } = msg;
      if (busy(model) || !movesTo(item, to.id)) return [model, []];
      const call =
        item.kind === "thread"
          ? post(`/api/threads/${item.id}/continue`, { workstream: to.id }, { kind: "moveJoined" })
          : post(`/api/workstreams/${to.id}/add`, { items: [item.id] }, { kind: "moveJoined" });
      return [
        { ...model, asking: null, pending: { item, to, joined: null, undo: null }, problem: null },
        [call],
      ];
    }
    case "droppedOnHeading":
      if (busy(model)) return [model, []];
      return [{ ...model, asking: { item: msg.item, at: msg.at }, problem: null }, []];
    // Named as picking the one item names a workstream.
    case "newClicked": {
      if (busy(model)) return [model, []];
      const { item } = msg;
      const body = { kind: "picked", name: oneItemName(item.title ?? item.key), items: [item.id] };
      return [
        { ...model, asking: null, pending: { item, to: null, joined: null, undo: null } },
        [post("/api/workstreams", body, { kind: "moveJoined" })],
      ];
    }
    case "askCancelled":
      return [{ ...model, asking: null }, []];
    case "undoClicked": {
      const { moved } = model;
      if (!moved || !model.shown || busy(model) || moved.undos.length === 0) return [model, []];
      // As every note's Undo does, it lets go of the keyboard's hold.
      const [released, restarts] = hold(model, "focus", false, again);
      return [
        { ...released, undoing: moved.undos.length, problem: null },
        [
          ...moved.undos.map((undo) => undoing(undo, { kind: "moveUndone", action: undo.action })),
          ...restarts,
        ],
      ];
    }
    case "undoHeld":
      return hold(model, msg.by, msg.held, again);
    case "undoExpired":
      if (!runsOut(model, msg.countdown)) return [model, []];
      return [{ ...model, shown: false }, []];
    case "problemDismissed":
      return [{ ...model, problem: null }, []];
  }
}

const expired = (countdown: number): Msg => ({
  type: "moving",
  msg: { type: "undoExpired", countdown },
});

// Once neither pointer nor keyboard holds it, the move gets its full time again.
const again = (model: MovingModel): [MovingModel, Effect[]] =>
  model.shown ? restart(model, expired) : [model, []];

// A move done: it shows, with its Undo, and starts to run out. A new
// workstream opens, as one made from Browse does, where it can be renamed.
function done(model: MovingModel, move: Move, problem: string | null): [MovingModel, Effect[]] {
  const countdown = model.countdown + 1;
  const opened: Effect[] = move.made
    ? [{ type: "navigate", route: { page: "workstream", id: move.to.id } }]
    : [];
  return [
    { ...model, pending: null, moved: move, shown: true, countdown, problem },
    [expiry(expired(countdown)), ...opened],
  ];
}

// The server's answer to a step of a move, or to its Undo.
export function movingReplied(model: MovingModel, msg: Replied): [MovingModel, Effect[]] {
  const { pending } = model;
  switch (msg.tag.kind) {
    case "moveJoined": {
      if (!pending) return [model, []];
      const { item } = pending;
      if (!msg.ok)
        return [
          {
            ...model,
            pending: null,
            problem: `Couldn't move ${named(item)}: ${errorOf(msg.body)}`,
          },
          [],
        ];
      if (item.kind === "thread" && pending.to) {
        const { undo } = msg.body as Undoable<ContinuedView>;
        const to = pending.to;
        return done(model, { item, to, made: false, undos: undo ? [undo] : [] }, null);
      }
      // An add answers with the workstream's view, a create with its summary.
      const body = msg.body as Undoable<{ workstream?: WorkstreamSummary } & Partial<Place>>;
      const joined: Place = pending.to ?? { id: body.id ?? "", name: body.name ?? "" };
      const next = { ...pending, joined, undo: body.undo };
      if (item.from === null) return done(model, move(next, joined, []), null);
      return [
        { ...model, pending: next },
        [
          post(
            `/api/workstreams/${item.from.id}/remove`,
            { items: [item.id] },
            { kind: "moveLeft" },
          ),
        ],
      ];
    }
    case "moveLeft": {
      if (!pending?.joined) return [model, []];
      const { item, joined } = pending;
      // It joined, but is still where it came from: its Undo takes it back out.
      if (!msg.ok)
        return done(
          model,
          move(pending, joined, []),
          `${named(item)} joined “${joined.name}”, but couldn't leave “${item.from?.name}”: ${errorOf(msg.body)}`,
        );
      const left = (msg.body as Undoable<unknown>).undo;
      return done(model, move(pending, joined, left ? [left] : []), null);
    }
    case "moveUndone": {
      const still = Math.max(0, model.undoing - 1);
      const { moved } = model;
      // One that landed is done with: an Undo tried again sends only the rest.
      const action = msg.tag.action;
      const left =
        moved && msg.ok
          ? { ...moved, undos: moved.undos.filter((u) => u.action !== action) }
          : moved;
      const problem = msg.ok
        ? model.problem
        : `Couldn't undo moving ${moved ? named(moved.item) : "it"}: ${errorOf(msg.body)}`;
      // Once every call has landed, it's gone from the stack.
      const over = still === 0 && left !== null && left.undos.length === 0;
      return [
        {
          ...model,
          undoing: still,
          problem: over ? null : problem,
          moved: over ? null : left,
          shown: over ? false : model.shown,
        },
        [],
      ];
    }
    default:
      return [model, []];
  }
}

function move(pending: NonNullable<MovingModel["pending"]>, joined: Place, left: UndoView[]): Move {
  return {
    item: pending.item,
    to: joined,
    made: pending.to === null,
    undos: [...(pending.undo ? [pending.undo] : []), ...left],
  };
}

// What a move did, in a sentence.
export function movedText(move: Move): string {
  const { item, to, made } = move;
  if (item.kind === "thread")
    return `Moved ${named(item)} from “${item.from.name}” to “${to.name}”.`;
  if (made) return `Moved ${item.key} to a new workstream, “${to.name}”.`;
  if (item.from === null) return `Added ${item.key} to “${to.name}”.`;
  return `Moved ${item.key} from “${item.from.name}” to “${to.name}”.`;
}

// The move as a note in the window's stack, and what last failed.
export function movingUndos(model: MovingModel, send: (msg: MovingMsg) => void): Undos {
  const { moved } = model;
  const said = moved && movedText(moved);
  return {
    notes:
      moved && said && model.shown
        ? [
            {
              key: `moved-${moved.item.id}-${moved.to.id}`,
              said,
              label: `Undo: ${said}`,
              onUndo: moved.undos.length > 0 ? () => send({ type: "undoClicked" }) : null,
              disabled: model.undoing > 0,
            },
          ]
        : [],
    problem: model.problem
      ? { said: model.problem, onDismiss: () => send({ type: "problemDismissed" }) }
      : null,
  };
}
