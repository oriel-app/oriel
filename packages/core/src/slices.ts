// Slices: proposed release cuts of a workstream that is too big for its
// date (the scope-lab spike, draft decision). The agent proposes two or
// three, from what the work is for, what was said about it and its items:
// what each slice defers, the customer outcomes it keeps and loses, in its
// own words with its items as chips, and what one item needs from another,
// as the agent reads it, citing the items it read that in. Oriel computes
// every figure: how many items a slice keeps and defers, the estimates
// recorded on them, and how many have none, so nothing the agent writes is
// a number. The person toggles items in and out and Oriel computes again
// with no model call. Points are never days: a figure says "recorded
// points", and nothing here turns one into time.
import { type Instant, isInstant, isItemId, isUlid, type ItemId, type Ulid } from "./ids.ts";
import type { IndexRecord, State } from "./source.ts";
import { array, type Infer, object, optional, refine, string, type Validator } from "./validate.ts";

export const minSlices = 2;
export const maxSlices = 3;
export const maxSliceName = 60;
export const maxOutcomes = 4;
export const maxOutcomeChars = 240;
export const maxNeeds = 12;
export const maxNeedChars = 160;

// What `[[…]]` names in an outcome, as an answer's chip (decision 0032).
const chipPattern = /\[\[\s*([^\][\s]+)\s*\]\]/g;
export const chipsIn = (text: string): string[] =>
  [...text.matchAll(chipPattern)].flatMap((match) => (match[1] ? [match[1]] : []));

const itemId = refine(string, isItemId, "expected an item ID, such as jira:SYN-12");
const text = (most: number) =>
  refine(
    string,
    (value) => value.trim() !== "" && [...value].length <= most,
    `expected 1 to ${most} characters`,
  );

// What the agent hands `slices()`.
export const sliceRequest = object({
  slices: array(
    object({
      name: text(maxSliceName),
      defer: array(itemId),
      keeps: array(text(maxOutcomeChars)),
      loses: array(text(maxOutcomeChars)),
    }),
  ),
  // `item` needs `on`: an item, or something that is no item ("ops' sign-off
  // on the wording"), as the agent read it in `from`.
  needs: optional(array(object({ item: itemId, on: text(maxNeedChars), from: array(itemId) }))),
});
export type SliceRequest = Infer<typeof sliceRequest>;

export const sliceRequestHelp =
  "slices({ slices: [{ name, defer: [ids], keeps: [outcome], loses: [outcome] }], needs?: [{ item, on, from: [ids] }] }): 2 or 3 slices; `defer` lists the open items a slice moves out, and it keeps every other open item; an outcome is one sentence for a customer, naming items as [[id]]; `needs` says an item needs another (`on`, an item ID or a few words for what is no item), and `from` the items you read that in, or [] for your own guess.";

// What Oriel knows of an item, from the index: where it stands, its
// estimate (absent when its source doesn't estimate), when it last changed
// and what it is.
export type SliceFact = {
  id: ItemId;
  state?: State;
  estimate?: number | null;
  updatedAt: Instant;
  kind?: string;
  container?: ItemId | null;
};

// An index record's facts, as slices read them.
export function sliceFactOf(record: IndexRecord): SliceFact {
  const { state, estimate, kind, container } = record.facets;
  return {
    id: record.id,
    updatedAt: record.updatedAt,
    ...(state === undefined ? {} : { state }),
    ...(estimate === undefined ? {} : { estimate }),
    ...(kind === undefined ? {} : { kind }),
    ...(container === undefined ? {} : { container: container?.id ?? null }),
  };
}

export type Need = { item: ItemId; on: string; from: ItemId[] };
export type Slice = { name: string; defer: ItemId[]; keeps: string[]; loses: string[] };

// A proposal as Oriel stores it with the turn: the items it covers, which
// slices the agent proposed, what the agent says items need, and the
// evidence, each item it rests on with when it last changed, so a later
// look can say it went stale. Every figure is computed when it is shown.
export type SliceSet = {
  id: Ulid;
  // The workstream's items a slice can keep or defer, in the region's order.
  items: ItemId[];
  slices: Slice[];
  needs: Need[];
  evidence: { id: ItemId; updatedAt: Instant }[];
};

const ulid = refine(string, isUlid, "expected a ULID");
const instant = refine(string, isInstant, "expected an instant");
export const storedSliceSet: Validator<SliceSet> = object({
  id: ulid,
  items: array(itemId),
  slices: array(
    object({ name: string, defer: array(itemId), keeps: array(string), loses: array(string) }),
  ),
  needs: array(object({ item: itemId, on: string, from: array(itemId) })),
  evidence: array(object({ id: itemId, updatedAt: instant })),
});

// The items a slice can cut: tracked work (it has a state) that isn't the
// container of another item in the workstream, as an epic is of its
// stories.
export function workOf(facts: readonly SliceFact[]): SliceFact[] {
  const containers = new Set(facts.flatMap((f) => (f.container ? [f.container] : [])));
  return facts.filter((f) => f.state !== undefined && !containers.has(f.id));
}

const open = (fact: SliceFact | undefined) => fact !== undefined && fact.state !== "done";

export type SlicesBuilt = { ok: true; value: SliceSet } | { ok: false; why: string };

// The proposal the agent asks for, checked against the workstream's items
// (`facts`) and what the run may name besides (`seen`, its search() hits,
// with when each last changed); or why not, in words the agent can act on.
export function buildSlices(
  id: Ulid,
  input: unknown,
  facts: readonly SliceFact[],
  seen: ReadonlyMap<string, Instant>,
): SlicesBuilt {
  const refuse = (why: string): SlicesBuilt => ({ ok: false, why });
  const checked = sliceRequest(input);
  if (!checked.ok)
    return refuse(
      `${checked.issues.map((i) => `${i.path}: ${i.message}`).join("; ")}. ${sliceRequestHelp}`,
    );
  const { slices, needs = [] } = checked.value;
  if (slices.length < minSlices || slices.length > maxSlices)
    return refuse(`propose ${minSlices} or ${maxSlices} slices, not ${slices.length}`);
  if (needs.length > maxNeeds) return refuse(`name at most ${maxNeeds} needs`);
  const work = workOf(facts);
  const byId = new Map(work.map((f) => [f.id as string, f]));
  const inRegion = new Set(facts.map((f) => f.id as string));
  const nameable = (named: string) => inRegion.has(named) || seen.has(named);
  const names = new Set<string>();
  const cuts = new Set<string>();
  for (const [i, slice] of slices.entries()) {
    const at = `slice ${i + 1} (${slice.name})`;
    if (names.has(slice.name)) return refuse(`${at}: two slices share its name`);
    names.add(slice.name);
    if (!slice.defer.length) return refuse(`${at} defers nothing; every slice defers something`);
    for (const deferred of slice.defer) {
      const fact = byId.get(deferred);
      if (!fact)
        return refuse(
          inRegion.has(deferred)
            ? `${at}: ${deferred} holds other items; defer its items instead`
            : `${at}: ${deferred} isn't one of the workstream's items`,
        );
      if (!open(fact)) return refuse(`${at}: ${deferred} is done, so it can't be deferred`);
    }
    const cut = [...new Set(slice.defer)].toSorted().join(" ");
    if (cuts.has(cut)) return refuse(`${at} defers what another slice does`);
    cuts.add(cut);
    if (slice.keeps.length > maxOutcomes || slice.loses.length > maxOutcomes)
      return refuse(`${at}: at most ${maxOutcomes} outcomes kept and ${maxOutcomes} lost`);
    if (!slice.keeps.length) return refuse(`${at} keeps no outcome`);
    const unknown = [...slice.keeps, ...slice.loses]
      .flatMap(chipsIn)
      .filter((named) => !nameable(named));
    if (unknown.length)
      return refuse(
        `${at} names ${unknown.join(", ")}, which neither the workstream holds nor this run found`,
      );
  }
  for (const [i, need] of needs.entries()) {
    const at = `need ${i + 1}`;
    if (!byId.has(need.item)) return refuse(`${at}: ${need.item} isn't one of the slices' items`);
    if (isItemId(need.on) && !nameable(need.on))
      return refuse(`${at}: ${need.on} is neither in the workstream nor found by this run`);
    const unread = need.from.filter((from) => !nameable(from));
    if (unread.length)
      return refuse(
        `${at}: you read nothing in ${unread.join(", ")} this run, so it can't cite it`,
      );
  }
  const cited = new Set<string>([
    ...facts.map((f) => f.id),
    ...slices.flatMap((s) => [...s.keeps, ...s.loses].flatMap(chipsIn)),
    ...needs.flatMap((n) => [...n.from, ...(isItemId(n.on) ? [n.on] : [])]),
  ]);
  const known = new Map([...seen, ...facts.map((f) => [f.id as string, f.updatedAt] as const)]);
  return {
    ok: true,
    value: {
      id,
      // Open items first, then done ones, each in their keys' order.
      items: work
        .toSorted(
          (a, b) =>
            Number(a.state === "done") - Number(b.state === "done") ||
            a.id.localeCompare(b.id, "en", { numeric: true }),
        )
        .map((f) => f.id),
      slices: slices.map((s) => ({
        name: s.name,
        defer: [...new Set(s.defer)] as ItemId[],
        keeps: s.keeps,
        loses: s.loses,
      })),
      needs: needs.map((n) => ({ item: n.item as ItemId, on: n.on, from: n.from as ItemId[] })),
      evidence: [...cited].flatMap((named) => {
        const updatedAt = known.get(named);
        return updatedAt && isItemId(named) ? [{ id: named, updatedAt }] : [];
      }),
    },
  };
}

// A side of a cut: how many items, the points recorded on those that have
// an estimate, and how many have none.
export type Side = { items: number; points: number; unestimated: number };
// A kept item that needs a deferred one, as the agent read it.
export type Broken = Need & { deferred: ItemId };

export type SliceFigures = {
  done: Side;
  kept: Side;
  deferred: Side;
  broken: Broken[];
};

const side = (facts: readonly SliceFact[]): Side => ({
  items: facts.length,
  points: facts.reduce((sum, f) => sum + (typeof f.estimate === "number" ? f.estimate : 0), 0),
  unestimated: facts.filter((f) => typeof f.estimate !== "number").length,
});

// What a cut keeps and defers, computed from the index as it is now: the
// workstream's open items not in `defer` are kept; done ones are counted
// apart, since there is nothing left to cut. An item gone from the index
// counts nowhere.
export function sliceFigures(
  set: SliceSet,
  facts: readonly SliceFact[],
  defer: ReadonlySet<string>,
): SliceFigures {
  const byId = new Map(facts.map((f) => [f.id as string, f]));
  const present = set.items.flatMap((id) => byId.get(id) ?? []);
  const done = present.filter((f) => f.state === "done");
  const live = present.filter((f) => f.state !== "done");
  const kept = live.filter((f) => !defer.has(f.id));
  const deferred = live.filter((f) => defer.has(f.id));
  const keptIds = new Set(kept.map((f) => f.id as string));
  return {
    done: side(done),
    kept: side(kept),
    deferred: side(deferred),
    broken: set.needs.flatMap((need) =>
      keptIds.has(need.item) && isItemId(need.on) && defer.has(need.on)
        ? [{ ...need, deferred: need.on }]
        : [],
    ),
  };
}

// What changed since the proposal: each item it rests on that changed or
// left the index, and the workstream's items it didn't cover or that left
// it. Stale when any did; nothing is proposed again on a look.
export type Staleness = { changed: ItemId[]; gone: ItemId[]; added: ItemId[]; removed: ItemId[] };

export function staleness(
  set: SliceSet,
  facts: readonly SliceFact[],
  region: readonly ItemId[],
): Staleness {
  const now = new Map(facts.map((f) => [f.id as string, f.updatedAt]));
  const covered = new Set<string>(set.items);
  const work = new Set<string>(workOf(facts.filter((f) => region.includes(f.id))).map((f) => f.id));
  return {
    changed: set.evidence.flatMap((e) => {
      const at = now.get(e.id);
      return at !== undefined && at !== e.updatedAt ? [e.id] : [];
    }),
    gone: set.evidence.flatMap((e) => (now.has(e.id) ? [] : [e.id])),
    added: [...work].filter((id) => !covered.has(id)) as ItemId[],
    removed: set.items.filter((id) => !work.has(id)),
  };
}

export const isStale = (s: Staleness) =>
  s.changed.length + s.gone.length + s.added.length + s.removed.length > 0;

// What the agent reads back after slices(): Oriel's figures for each slice,
// so the reply quotes Oriel's numbers rather than its own.
export function slicesSaid(set: SliceSet, facts: readonly SliceFact[]): string {
  const points = (n: number) => (n === 1 ? "1 recorded point" : `${n} recorded points`);
  const sideSaid = (s: Side) =>
    `${s.items} item${s.items === 1 ? "" : "s"}, ${points(s.points)}${s.unestimated ? `, ${s.unestimated} with no estimate` : ""}`;
  const lines = set.slices.map((slice) => {
    const f = sliceFigures(set, facts, new Set(slice.defer));
    const broken = f.broken.length
      ? ` It defers what ${f.broken.map((b) => `${b.item} needs (${b.deferred})`).join(", ")}, by your reading.`
      : "";
    return `${slice.name}: keeps ${sideSaid(f.kept)}; defers ${sideSaid(f.deferred)}.${broken}`;
  });
  return `Oriel shows ${set.slices.length} slices under your reply, which the user can change and turn into a change set. Computed by Oriel; points are not time, so don't turn them into days. ${lines.join(" ")}`;
}
