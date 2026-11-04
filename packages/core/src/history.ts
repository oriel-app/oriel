// `history()`: items as the index holds them, with what the change log saw
// of each: when it started, when it was done, and how long it has been in
// its state. IDs and facets only, never content: an item and its epic are
// their IDs, whose names Oriel draws. From the index and the change log
// alone, with no call to a source and no model, so a block built from it
// can be rerun on the overview as a pin (decision 0053).
//
// The change log starts when Oriel first saw a change, and keeps 90 days
// (decision 0027); before that, Oriel knows only that something had
// happened, not when. So a date at `since` means "by then": an item already
// done when the log starts is done at `since`, and one already in its state
// has been in it at least since then (`inStateBefore`). Charts read `since`
// from the read's declared fields and say so.
import type { ResultFields } from "./block.ts";
import type { ChangeLogEntry } from "./change-log.ts";
import { dayMs } from "./chart.ts";
import { type Instant, type ItemId, parseItemId } from "./ids.ts";
import type { IndexRecord, State } from "./source.ts";

export const stateNames: Record<State, string> = {
  todo: "To do",
  "in-progress": "In progress",
  done: "Done",
};

export type HistoryItem = {
  id: ItemId;
  source: string;
  kind: string | null;
  state: string | null;
  assignee: string | null;
  // The item that holds it, as an epic holds its stories.
  epic: ItemId | null;
  estimate: number | null;
  startedAt: Instant | null;
  doneAt: Instant | null;
  stateSince: Instant | null;
  daysInState: number | null;
  inStateBefore: boolean;
  daysSinceUpdate: number;
};

export type History = { asOf: Instant; since: Instant; items: HistoryItem[] };

// What a block can show of it (decision 0030): the items, by these labels,
// over the change log's dates. It holds no content, so a block of it isn't
// the escape hatch, though it reads outside the region (decision 0053).
export const historyFields: ResultFields = {
  source: "the index and its change log",
  contentFree: true,
  time: { asOf: "asOf", since: "since" },
  atLeast: { daysInState: "inStateBefore" },
  sums: ["estimate"],
  lists: {
    items: {
      id: "Item",
      source: "Source",
      kind: "Type",
      state: "State",
      assignee: "Assignee",
      epic: "Epic",
      estimate: "Estimate",
      startedAt: "Started",
      doneAt: "Done",
      stateSince: "In its state since",
      daysInState: "Days in its state",
      daysSinceUpdate: "Days since an update",
    },
  },
};

// The history of `records`, from the whole change log `changes`, as of
// `asOf`.
export function historyOf(
  records: readonly IndexRecord[],
  changes: readonly ChangeLogEntry[],
  asOf: Instant,
): History {
  const since =
    changes.reduce<Instant | null>(
      (first, e) => (first === null || e.at < first ? e.at : first),
      null,
    ) ?? asOf;
  const now = Date.parse(asOf);
  const days = (from: string) => Math.floor((now - Date.parse(from)) / dayMs);
  const byItem = new Map<string, ChangeLogEntry[]>();
  for (const entry of changes) {
    if (!entry.facets.state) continue;
    const key = `${entry.source}\u0000${entry.stableId}`;
    const moves = byItem.get(key);
    if (moves) moves.push(entry);
    else byItem.set(key, [entry]);
  }
  const items = records.map((record): HistoryItem => {
    const prefix = parseItemId(record.id)?.prefix ?? "";
    const moves = (byItem.get(`${prefix}\u0000${record.stableId}`) ?? []).toSorted(
      (a, b) => a.seq - b.seq,
    );
    const state = record.facets.state ?? null;
    const last = moves.at(-1);
    // A state the log never saw it reach was reached by `since`, if nothing
    // has touched the item since then, and by its last update otherwise: it
    // may have joined the index after the log started, unlogged.
    const by = record.updatedAt <= since ? since : record.updatedAt;
    const first = moves[0]?.facets.state?.before;
    const startedEarlier = moves.length === 0 || (first !== undefined && first !== "todo");
    const started = moves.find((e) => e.facets.state?.after !== "todo");
    const done = moves.findLast((e) => e.facets.state?.after === "done");
    const stateSince = state === null ? null : (last?.at ?? by);
    return {
      id: record.id,
      source: prefix,
      kind: record.facets.kind ?? null,
      state: state === null ? null : stateNames[state],
      assignee: record.facets.people?.find((person) => person.role === "assignee")?.name ?? null,
      epic: record.facets.container?.id ?? null,
      estimate: record.facets.estimate ?? null,
      // Moving from a started state first, it had started by the time the
      // log began, whatever touched it since.
      startedAt:
        state === null || state === "todo"
          ? null
          : startedEarlier
            ? moves.length
              ? since
              : by
            : (started?.at ?? by),
      doneAt: state === "done" ? (done?.at ?? by) : null,
      stateSince,
      daysInState: stateSince === null ? null : days(stateSince),
      inStateBefore: state !== null && last === undefined,
      daysSinceUpdate: Math.max(days(record.updatedAt), 0),
    };
  });
  return { asOf, since, items };
}
