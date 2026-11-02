// What every Undo note in the window's stack shares (OA-142): how long one
// shows while the user isn't on the stack, and what holds it meanwhile.

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
