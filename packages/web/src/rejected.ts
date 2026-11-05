// After the person rejects a change set in a thread (OA-258): a note in the
// bead, with Undo, which puts the change set back to awaiting review as it
// was, with its second look. The server may refuse, as once the person has
// told the agent what was wrong: then the bead says why until dismissed. A
// review link's holder rejects on a page of their own, with no bead, and
// the server gives no Undo for that.
import { errorOf, type Effect, type Replied, undoing } from "./http.ts";
import type { Model, Msg } from "./root.ts";
import { type Held, type Hold, hold, notHeld, restart, runsOut, type Undos } from "./undos.ts";
import type { UndoView } from "./view.ts";

export type RejectedNote = {
  changeSetId: string;
  // The thread it was rejected in, by its name then.
  title: string | null;
  undo: UndoView;
};

export type RejectedModel = {
  // The note, while it shows.
  note: RejectedNote | null;
  // Its Undo is in flight.
  undoing: boolean;
  // The times its countdown started; only the latest one's end hides it.
  countdown: number;
  held: Held;
  // Why the last Undo was refused, said until dismissed, in the place of
  // the note it was for (`key`).
  problem: { key: string; said: string } | null;
};

export type RejectedMsg =
  | { type: "undoClicked" }
  | { type: "undoHeld"; by: Hold; held: boolean }
  | { type: "expired"; countdown: number }
  | { type: "problemDismissed" };

export const initRejected = (): RejectedModel => ({
  note: null,
  undoing: false,
  countdown: 0,
  held: notHeld,
  problem: null,
});

// The rejection a reply from the thread's page says stood, with its Undo:
// the note for it, or null for any other reply.
export function rejectedIn(before: Model, msg: Msg): RejectedNote | null {
  const { thread } = before;
  if (msg.type !== "replied" || !msg.ok || msg.tag.kind !== "changeSet") return null;
  const { changeSetId } = msg.tag;
  if (thread === null || thread.deciding[changeSetId]?.kind !== "rejected") return null;
  const undo = undoOf(msg.body);
  return undo && { changeSetId, title: thread.view?.title ?? null, undo };
}

// A reply's Undo, if it has one.
function undoOf(body: unknown): UndoView | null {
  if (typeof body !== "object" || body === null || !("undo" in body)) return null;
  const { undo } = body as { undo: UndoView | null };
  return undo;
}

// Shows `note`, with its full time, in place of any before it.
export const noted = (model: RejectedModel, note: RejectedNote): [RejectedModel, Effect[]] =>
  restart({ ...model, note, undoing: false, problem: null }, expired);

export function updateRejected(model: RejectedModel, msg: RejectedMsg): [RejectedModel, Effect[]] {
  switch (msg.type) {
    case "undoClicked": {
      const { note } = model;
      if (note === null || model.undoing) return [model, []];
      // As a removal's Undo does, it lets go of the keyboard's hold.
      const [released, restarts] = hold(model, "focus", false, again);
      return [
        { ...released, undoing: true, problem: null },
        [undoing(note.undo, { kind: "unrejected", changeSetId: note.changeSetId }), ...restarts],
      ];
    }
    case "undoHeld":
      return hold(model, msg.by, msg.held, again);
    case "expired":
      if (!runsOut(model, msg.countdown)) return [model, []];
      return [{ ...model, note: null }, []];
    case "problemDismissed":
      return [{ ...model, problem: null }, []];
  }
}

// Undone, the note goes: the thread says so in its own line. Refused, the
// note gives way to why.
export function rejectedReplied(model: RejectedModel, msg: Replied): RejectedModel {
  if (msg.tag.kind !== "unrejected" || model.note?.changeSetId !== msg.tag.changeSetId)
    return model;
  return {
    ...model,
    note: null,
    undoing: false,
    problem: msg.ok
      ? null
      : { key: noteKey(msg.tag.changeSetId), said: `Couldn't undo it: ${errorOf(msg.body)}` },
  };
}

const expired = (countdown: number): Msg => ({
  type: "rejected",
  msg: { type: "expired", countdown },
});

// Once neither pointer nor keyboard holds it, the note gets its full time again.
const again = (model: RejectedModel): [RejectedModel, Effect[]] =>
  model.note ? restart(model, expired) : [model, []];

const named = (title: string | null) => `“${title ?? "New thread"}”`;

// The note, for the bead, and why an Undo was refused.
export function rejectedUndos(model: RejectedModel, send: (msg: RejectedMsg) => void): Undos {
  const { note } = model;
  const said = note && `You rejected the change in ${named(note.title)}.`;
  return {
    notes:
      note && said
        ? [
            {
              key: noteKey(note.changeSetId),
              said,
              label: `Undo: ${said}`,
              onUndo: () => send({ type: "undoClicked" }),
              disabled: model.undoing,
            },
          ]
        : [],
    problem: model.problem && {
      ...model.problem,
      onDismiss: () => send({ type: "problemDismissed" }),
    },
  };
}

const noteKey = (changeSetId: string) => `rejected-${changeSetId}`;
