// A candidate is data with its rule, never HTML and never a model's words.
import type { ChangeLogEntry } from "./change-log.ts";
import type { Instant, ItemId } from "./ids.ts";
import type { IndexRecord } from "./source.ts";

export type Candidate = {
  subject: { kind: "item"; id: ItemId } | { kind: "cluster"; grouping: string; key: string };
  rule: string;
  weight: number;
  // In Oriel's words, never source text.
  detail?: string;
};

// One shared scale, so no source outranks the rest by inflating its own.
export const weights = {
  glance: 1,
  stalled: 1.5,
  asks: 2,
  moved: 1,
} as const;

export type OverviewInput = {
  records: readonly IndexRecord[];
  changes: readonly ChangeLogEntry[];
  held: (record: IndexRecord) => boolean;
  now: Instant;
};

export type OverviewOf = (input: OverviewInput) => Candidate[];

const day = 86_400_000;

export const daysSince = (at: Instant, now: Instant): number =>
  Math.max(0, Math.floor((Date.parse(now) - Date.parse(at)) / day));

// Within 7 days of `now`, before or after it: a clock that runs behind the source's puts it after.
export const thisWeek = (at: Instant, now: Instant): boolean =>
  Math.abs(Date.parse(now) - Date.parse(at)) < 7 * day;

export const stuckDays = 14;

export const stalled = (record: IndexRecord, now: Instant): boolean =>
  record.facets.state === "in-progress" && daysSince(record.updatedAt, now) >= stuckDays;

export const overviewSections = [
  "changed",
  "needs-you",
  "workstreams",
  "candidates",
  "people",
] as const;
export type OverviewSection = (typeof overviewSections)[number];

export const isOverviewSection = (value: string): value is OverviewSection =>
  overviewSections.some((section) => section === value);
