// `history()`: items as the index holds them, with what the change log saw
// of each: when it started, when it was done, and how long it has been in
// its state. Facets only, never content, from the index and the change log
// alone, with no call to a source and no model, so a block built from it
// can be rerun on the overview as a pin (decision 0030).
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
  title: string;
  source: string;
  kind: string | null;
  state: string | null;
  assignee: string | null;
  epic: string | null;
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
// over the change log's dates.
export const historyFields: ResultFields = {
  source: "the index and its change log",
  time: { asOf: "asOf", since: "since" },
  atLeast: { daysInState: "inStateBefore" },
  sums: ["estimate"],
  lists: {
    items: {
      id: "Item",
      title: "Title",
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

const days = (from: string, to: string) => Math.floor((Date.parse(to) - Date.parse(from)) / dayMs);

// The history of `records`, from the whole change log `changes`, as of
// `asOf`. `all` is every live record, for the names of containers.
export function historyOf(
  records: readonly IndexRecord[],
  changes: readonly ChangeLogEntry[],
  asOf: Instant,
  all: readonly IndexRecord[] = records,
): History {
  const since =
    changes.reduce<Instant | null>(
      (first, e) => (first === null || e.at < first ? e.at : first),
      null,
    ) ?? asOf;
  const byItem = new Map<string, ChangeLogEntry[]>();
  for (const entry of changes) {
    if (!entry.facets.state) continue;
    const key = `${entry.source}\u0000${entry.stableId}`;
    byItem.set(key, [...(byItem.get(key) ?? []), entry]);
  }
  const titles = new Map<string, string>(all.map((record) => [record.id, record.title]));
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
      title: record.title,
      source: prefix,
      kind: record.facets.kind ?? null,
      state: state === null ? null : stateNames[state],
      assignee: record.facets.people?.find((person) => person.role === "assignee")?.name ?? null,
      epic: record.facets.container ? (titles.get(record.facets.container.id) ?? null) : null,
      estimate: record.facets.estimate ?? null,
      startedAt:
        state === null || state === "todo" ? null : startedEarlier ? by : (started?.at ?? by),
      doneAt: state === "done" ? (done?.at ?? by) : null,
      stateSince,
      daysInState: stateSince === null ? null : days(stateSince, asOf),
      inStateBefore: state !== null && last === undefined,
      daysSinceUpdate: Math.max(days(record.updatedAt, asOf), 0),
    };
  });
  return { asOf, since, items };
}
