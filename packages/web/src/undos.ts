// What every Undo note in the window's stack shares (OA-142): how long one
// shows while the user isn't on the stack, and what holds it meanwhile.
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

// Letting go by `by`: the hold left, and whether the notes it held each get
// their full time again, which they do once nothing holds them.
export function letGo(held: Held, by: Hold): [Held, boolean] {
  const left = { ...held, [by]: false };
  return [left, holding(held) && !holding(left)];
}

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
