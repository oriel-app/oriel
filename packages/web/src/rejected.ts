import { errorOf, type Effect, type Replied, undoing } from "./http.ts";
import type { Model, Msg } from "./root.ts";
import { type Held, type Hold, hold, notHeld, restart, runsOut, type Undos } from "./undos.ts";
import type { UndoView } from "./view.ts";

export type RejectedNote = {
  changeSetId: string;
  title: string | null;
  undo: UndoView;
};

export type RejectedModel = {
  note: RejectedNote | null;
  undoing: boolean;
  countdown: number;
  held: Held;
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

export function rejectedIn(before: Model, msg: Msg): RejectedNote | null {
  const { thread } = before;
  if (msg.type !== "replied" || !msg.ok || msg.tag.kind !== "changeSet") return null;
  const { changeSetId } = msg.tag;
  if (thread === null || thread.deciding[changeSetId]?.kind !== "rejected") return null;
  const undo = undoOf(msg.body);
  return undo && { changeSetId, title: thread.view?.title ?? null, undo };
}

function undoOf(body: unknown): UndoView | null {
  if (typeof body !== "object" || body === null || !("undo" in body)) return null;
  const { undo } = body as { undo: UndoView | null };
  return undo;
}

export const noted = (model: RejectedModel, note: RejectedNote): [RejectedModel, Effect[]] =>
  restart({ ...model, note, undoing: false, problem: null }, expired);

export function updateRejected(model: RejectedModel, msg: RejectedMsg): [RejectedModel, Effect[]] {
  switch (msg.type) {
    case "undoClicked": {
      const { note } = model;
      if (note === null || model.undoing) return [model, []];
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

const again = (model: RejectedModel): [RejectedModel, Effect[]] =>
  model.note ? restart(model, expired) : [model, []];

const named = (title: string | null) => `“${title ?? "New thread"}”`;

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
