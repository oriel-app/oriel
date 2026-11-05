// Eight weeks behind a world whose items stand as their fixture has them:
// which item moved to which state in which week, so a change log can hold
// what a team's would. Deterministic, by each item's key: every run moves
// the same items in the same weeks. The last week leaves each item as its
// fixture has it. The screenshots sync a Jira site in memory through these
// moves (scripts/history-world.ts); an eval case with `past` gets them as
// change log entries, for history().
import type { State } from "@oriel/core";

export const pastWeeks = 8;

export type PastItem = { key: string; kind: string | null; state: State; epic: string | null };
// What moves in week k (0 to `pastWeeks`): each item's key and its new state.
export type Moves = Map<number, [string, State][]>;

const n = (key: string) => Number(key.split("-")[1] ?? 0);

// Each item's state before the first week, and its moves. A story done now
// started a week or three before it was done, and one in five was already
// done, or in progress, before the log starts. The checkout epic's stories
// move steadily, about one a week, as a team's planned epic does. In week 0
// an epic was started, to start the log, and it was shelved in the last.
export function pastOf(items: readonly PastItem[]): { start: Map<string, State>; moves: Moves } {
  const moves: Moves = new Map();
  const start = new Map<string, State>();
  const at = (k: number, key: string, state: State) =>
    moves.set(k, [...(moves.get(k) ?? []), [key, state]]);
  at(0, "SYN-7", "in-progress");
  at(pastWeeks, "SYN-7", "todo");
  for (const item of items) {
    const i = n(item.key);
    start.set(item.key, item.state);
    if (item.kind === "epic" || item.state === "todo" || i % 5 === 0) continue;
    start.set(item.key, "todo");
    const checkout = item.epic === "SYN-1";
    if (item.state === "done") {
      const done = checkout ? 1 + (i % 7) : Math.min(pastWeeks, 2 + ((i * 3) % 7));
      at(Math.max(1, done - 1 - (i % 3)), item.key, "in-progress");
      at(done, item.key, "done");
      continue;
    }
    at(
      Math.min(checkout ? 4 + (i % 5) : 1 + ((i * 5) % pastWeeks), pastWeeks),
      item.key,
      "in-progress",
    );
  }
  if (!start.has("SYN-7")) moves.delete(0);
  return { start, moves };
}
