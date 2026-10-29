import type { Instant, ItemId } from "./ids.ts";
import type { IndexRecord } from "./source.ts";

// A cluster either mirrors structure the source has (a Jira epic) or is derived
// by Oriel, in which case `derived` says how, and the UI shows it. `anchor` is
// the item the cluster hangs off, if any (the epic itself).
export type Cluster = {
  key: string;
  label: string;
  anchor: ItemId | null;
  itemIds: ItemId[];
  origin: "source" | { derived: string };
};

// Pure: no I/O and no clock reads; `now` is passed in.
export interface Grouping<R extends IndexRecord = IndexRecord> {
  readonly id: string;
  readonly label: string;
  group(records: readonly R[], now: Instant): Cluster[];
}
