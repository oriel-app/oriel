import type { Cluster } from "./grouping.ts";
import type { Instant, ItemId } from "./ids.ts";
import type { IndexRecord } from "./source.ts";

export type ZoomId = "cluster" | "list" | "item";

// Generated, never source data. Every claim cites the items it rests on; an
// uncited claim fails the zoom-faithfulness eval.
export type Summary = {
  claims: { text: string; cites: ItemId[] }[];
  // Stale when the index has moved past this snapshot version.
  snapshot: number;
  generated: { model: string; at: Instant };
};

// `view` builds plain view data for the web package to render, so zoom levels
// are testable without a DOM. A summarizer gets its model and reads injected
// when it is constructed.
export interface ZoomLevel<V, R extends IndexRecord = IndexRecord> {
  readonly id: ZoomId;
  view(cluster: Cluster, records: readonly R[]): V;
  summarize?(cluster: Cluster, records: readonly R[]): Promise<Summary>;
}
