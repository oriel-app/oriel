import type { Effect } from "./http.ts";
import type { Msg } from "./root.ts";
import type { Route } from "./route.ts";

export type UndoNote = {
  key: string;
  said: string;
  label: string;
  onUndo: (() => void) | null;
  cannot?: string;
  disabled?: boolean;
  heard?: string;
  link?: { text: string; label: string; route: Route };
  mark?: "applying" | "applied" | "caught-up";
};

export type UndoProblem = { said: string; onDismiss(): void; key?: string };

export type Undos = { notes: UndoNote[]; problem: UndoProblem | null };

export const undoMs = 8_000;

export type Hold = "pointer" | "focus";
export type Held = Readonly<Record<Hold, boolean>>;

export const notHeld: Held = { pointer: false, focus: false };

export const holding = (held: Held): boolean => held.pointer || held.focus;

export type Counting = { held: Held; countdown: number };

export const expiry = (msg: Msg): Effect => ({ type: "after", ms: undoMs, msg });

export function restart<M extends Counting>(
  model: M,
  expired: (countdown: number) => Msg,
): [M, Effect[]] {
  const countdown = model.countdown + 1;
  return [{ ...model, countdown }, [expiry(expired(countdown))]];
}

export function hold<M extends { held: Held }>(
  model: M,
  by: Hold,
  held: boolean,
  restarted: (model: M) => [M, Effect[]],
): [M, Effect[]] {
  const next = { ...model, held: { ...model.held, [by]: held } };
  return holding(model.held) && !holding(next.held) ? restarted(next) : [next, []];
}

export const runsOut = (model: Counting, countdown: number): boolean =>
  countdown === model.countdown && !holding(model.held);

export const latestNote = <T extends { onUndo: unknown }>(notes: readonly T[]): T | null =>
  notes.findLast((note) => note.onUndo !== null) ?? null;

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
