// What each source offers the overview (decision 0027): candidates for what
// to curate next, never a section of its own. A source declares `overview`
// as it declares its `panel`, a pure function of its index records, the
// change log, which items a workstream holds, and `now`. The overview ranks
// every source's candidates together, by weight, in one section. A
// candidate is data with its rule, never HTML and never a model's words.
import type { ChangeLogEntry } from "./change-log.ts";
import type { Instant, ItemId } from "./ids.ts";
import type { IndexRecord } from "./source.ts";

export type Candidate = {
  // An item, or a cluster of a grouping, by its key there, which Make a
  // workstream copies as it does from Browse.
  subject: { kind: "item"; id: ItemId } | { kind: "cluster"; grouping: string; key: string };
  // The rule that found it, in words the overview shows beside it, the same
  // for every candidate it finds: "In progress, no update in 14 days".
  rule: string;
  // How much it asks of the user now, on the scale every source shares
  // (`weights`). The overview ranks by it, then by how recently the
  // candidate's items changed.
  weight: number;
  // What the rule measured for this one, in Oriel's words, such as "26 days
  // idle"; never source text.
  detail?: string;
};

// The shared scale, so no source outranks the rest by inflating its own: a
// candidate is worth about as many items as it asks the user to look at.
export const weights = {
  // One item that may want a look, such as a file edited this week.
  glance: 1,
  // One item that has stalled.
  stalled: 1.5,
  // One item that asks the user something, such as a question nobody
  // answered.
  asks: 2,
  // Each item of a cluster that changed in the last 7 days, on top of the
  // cluster's own glance.
  moved: 1,
} as const;

// What a source's `overview` reads. `records` and `changes` are its own,
// the change log oldest first.
export type OverviewInput = {
  records: readonly IndexRecord[];
  changes: readonly ChangeLogEntry[];
  // Whether an open workstream holds the item.
  held: (record: IndexRecord) => boolean;
  now: Instant;
};

export type OverviewOf = (input: OverviewInput) => Candidate[];

const day = 86_400_000;

// Whole days from `at` to `now`; 0 for an instant after `now`.
export const daysSince = (at: Instant, now: Instant): number =>
  Math.max(0, Math.floor((Date.parse(now) - Date.parse(at)) / day));

// Whether `at` is within 7 days of `now`: before it, or after it, as a
// clock that runs behind the source's would put it.
export const thisWeek = (at: Instant, now: Instant): boolean =>
  Math.abs(Date.parse(now) - Date.parse(at)) < 7 * day;

// How long an item not done goes without an update before it is stuck:
// Browse's Stuck grouping and the overview's signals share it.
export const stuckDays = 14;

// Whether an item in progress has had no update in `stuckDays`.
export const stalled = (record: IndexRecord, now: Instant): boolean =>
  record.facets.state === "in-progress" && daysSince(record.updatedAt, now) >= stuckDays;
