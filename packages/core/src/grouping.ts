import type { Instant, ItemId, ItemOrder } from "./ids.ts";
import type { IndexRecord } from "./source.ts";

export type Cluster = {
  // Stable across syncs: frozen fixture regions depend on the epic grouping keying by the epic's stable ID.
  key: string;
  label: string;
  anchor: ItemId | null;
  itemIds: ItemId[];
  origin: "source" | { derived: string };
};

export const clusterMembers = (cluster: Cluster): ItemId[] => [
  ...new Set(cluster.anchor === null ? cluster.itemIds : [cluster.anchor, ...cluster.itemIds]),
];

// Pure: no I/O and no clock reads; `now` is passed in.
export interface Grouping<R extends IndexRecord = IndexRecord> {
  readonly id: string;
  readonly label: string;
  group(records: readonly R[], now: Instant, order: ItemOrder): Cluster[];
}
