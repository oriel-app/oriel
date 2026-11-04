// Release slices in the window (the scope-lab spike): a proposal as the
// thread shows it, with Oriel's figures from the index as it is now, a cut's
// figures as the person toggles items, and the change set a cut makes. No
// model is called here.
import {
  type CapturedMutation,
  type IndexRecord,
  type Region,
  type SliceFact,
  type ItemId,
  isStale,
  parseItemId,
  type SliceSet,
  sliceFactOf,
  sliceFigures,
  staleness,
  type Ulid,
} from "@oriel/core";
import type { Message } from "@oriel/db";
import type { SliceFiguresView, SlicesView } from "@oriel/web/view";
import { agentEvent } from "./agent.ts";

// The words a new epic for what a cut defers takes after the name of the
// epic its items share.
export const laterSuffix = " — next release";

const figuresView = (
  set: SliceSet,
  records: readonly IndexRecord[],
  defer: ReadonlySet<string>,
): SliceFiguresView => sliceFigures(set, records.map(sliceFactOf), defer);

export function slicesView(
  set: SliceSet,
  records: readonly IndexRecord[],
  region: readonly ItemId[],
  writable: boolean,
): SlicesView {
  const byId = new Map(records.map((r) => [r.id as string, r]));
  const facts = records.map(sliceFactOf);
  const stale = staleness(set, facts, region);
  // The epic most of its items sit in, by its title now, for the later
  // epic's name, which the person can change before making the change set.
  const counts = new Map<string, number>();
  for (const id of set.items) {
    const container = byId.get(id)?.facets.container?.id;
    if (container) counts.set(container, (counts.get(container) ?? 0) + 1);
  }
  const shared = [...counts].toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  const sharedTitle = shared ? byId.get(shared)?.title : undefined;
  const anyMovable = set.items.some((id) => movable(id, byId.get(id)));
  return {
    id: set.id,
    items: set.items.map((id) => {
      const record = byId.get(id);
      const estimate = record?.facets.estimate;
      return {
        id,
        done: record?.facets.state === "done",
        estimate: typeof estimate === "number" ? estimate : null,
        gone: !record,
        movable: writable && movable(id, record),
      };
    }),
    slices: set.slices.map((slice) => ({
      ...slice,
      figures: figuresView(set, records, new Set(slice.defer)),
    })),
    needs: set.needs,
    stale: isStale(stale) ? stale : null,
    later:
      writable && anyMovable
        ? { name: sharedTitle ? `${sharedTitle}${laterSuffix}` : "Later" }
        : null,
  };
}

export const cutFigures = figuresView;

// A region's items as the index has them now, for a turn's slices().
export function regionFacts(records: readonly IndexRecord[], region: Region): SliceFact[] {
  const ids = new Set<string>(region.items.map((member) => member.id));
  return records.filter((record) => ids.has(record.id)).map(sliceFactOf);
}

// The slices a thread's message holds, with the run that proposed them;
// null for any other message.
export function slicesIn(message: Message): { runId: Ulid; set: SliceSet } | null {
  if (message.role !== "agent") return null;
  const checked = agentEvent(message.event);
  if (!checked.ok || checked.value.kind !== "slices") return null;
  return { runId: checked.value.runId, set: checked.value.slices };
}

// Whether a cut can move an item: an open item of the first Jira
// connection, where a new epic with no target is made; anything else stays
// where it is, and the lab says so.
export const movable = (id: string, record: IndexRecord | undefined) =>
  parseItemId(id)?.prefix === "jira" && record !== undefined && record.facets.state !== "done";

// The mutations a cut proposes: a new epic named `later`, and each deferred
// item that can move moved into it.
export function cutMutations(
  set: SliceSet,
  records: readonly IndexRecord[],
  defer: readonly string[],
  later: string,
): { mutations: CapturedMutation[] } {
  const byId = new Map(records.map((r) => [r.id as string, r]));
  const moved: ItemId[] = set.items.filter((id) => defer.includes(id) && movable(id, byId.get(id)));
  if (!moved.length) return { mutations: [] };
  return {
    mutations: [
      { op: "createEpic", target: null, ref: "new:1", args: { summary: later } },
      ...moved.map((id) => ({
        op: "setEpic",
        target: id,
        ref: null,
        args: { epic: "new:1" },
      })),
    ],
  };
}
