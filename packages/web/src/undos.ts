// What every Undo note in the window's stack shares (OA-142): how long one
// shows while the user isn't on the stack, and what holds it meanwhile.
import type { Effect } from "./http.ts";
import type { Msg } from "./root.ts";
import type { Route } from "./route.ts";

// A note in the stack (undo-stack.tsx): what was done, and its Undo.
export type UndoNote = {
  key: string;
  said: string;
  // The Undo as a screen reader names it.
  label: string;
  // Null when it can't be undone, which `cannot` then says, if anything.
  onUndo: (() => void) | null;
  cannot?: string;
  disabled?: boolean;
  // Read out after `said`, for a screen reader only.
  heard?: string;
  // A link in place of an Undo, as back to the thread a page moved on from.
  link?: { text: string; label: string; route: Route };
};

// What last failed, said at the foot of the stack until dismissed.
export type UndoProblem = { said: string; onDismiss(): void };

// Notes for the stack from one part of the window, and what last failed there.
export type Undos = { notes: UndoNote[]; problem: UndoProblem | null };

// How long an Undo shows, while the user isn't on its stack.
export const undoMs = 8_000;

// The user is on the stack, by pointer or keyboard: no note runs out meanwhile.
export type Hold = "pointer" | "focus";
export type Held = Readonly<Record<Hold, boolean>>;

export const notHeld: Held = { pointer: false, focus: false };

export const holding = (held: Held): boolean => held.pointer || held.focus;

// The countdown every Undo note runs on: what holds the notes, and the times
// their countdown started, of which only the latest one's end hides them.
export type Counting = { held: Held; countdown: number };

// A countdown's full time from now, ending with `msg`.
export const expiry = (msg: Msg): Effect => ({ type: "after", ms: undoMs, msg });

// The notes' countdown, started again with their full time: only the end of
// this one, which `expired` says, hides them.
export function restart<M extends Counting>(
  model: M,
  expired: (countdown: number) => Msg,
): [M, Effect[]] {
  const countdown = model.countdown + 1;
  return [{ ...model, countdown }, [expiry(expired(countdown))]];
}

// The pointer or keyboard taking hold of the notes, by `by`, or letting go.
// Once nothing holds them, `restarted` gives those still showing their full
// time again.
export function hold<M extends { held: Held }>(
  model: M,
  by: Hold,
  held: boolean,
  restarted: (model: M) => [M, Effect[]],
): [M, Effect[]] {
  const next = { ...model, held: { ...model.held, [by]: held } };
  return holding(model.held) && !holding(next.held) ? restarted(next) : [next, []];
}

// Whether the countdown that ended hides the notes: only the latest does,
// and only while nothing holds them.
export const runsOut = (model: Counting, countdown: number): boolean =>
  countdown === model.countdown && !holding(model.held);

// The note ⌘Z or Ctrl+Z undoes: the newest, at the bottom, that can be undone.
export const latestNote = <T extends { onUndo: unknown }>(notes: readonly T[]): T | null =>
  notes.findLast((note) => note.onUndo !== null) ?? null;

// The stack's notes in the order they first showed, whichever part of the
// window each comes from: `shown`, the keys in that order so far, and the
// notes now. A note already there keeps its place, and a new one goes below.
export function inShowingOrder<T extends { key: string }>(
  shown: readonly string[],
  notes: readonly T[],
): T[] {
  const place = (note: T) => {
    const at = shown.indexOf(note.key);
    return at === -1 ? shown.length + notes.indexOf(note) : at;
  };
  return [...notes].sort((a, b) => place(a) - place(b));
}
