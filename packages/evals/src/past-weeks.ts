import type { State } from "@oriel/core";

export const pastWeeks = 8;

export type PastItem = { key: string; kind: string | null; state: State; epic: string | null };
export type Moves = Map<number, [string, State][]>;

const n = (key: string) => Number(key.split("-")[1] ?? 0);

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
