import type { Cluster } from "./grouping.ts";
import type { Instant, ItemId, SourceKind } from "./ids.ts";
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

// What a source's items show in the window beyond core's fields: the
// source's own words for an item's type and status, and its labels. An
// adapter declares how to read them from its index records, and the
// composition root passes that in, by source kind. A source with none shows
// what core knows. `replies` counts the replies under a chat message, which
// are part of it.
export type ItemDetails = { type: string; status: string; labels: string[]; replies?: number };
export type DetailsOf = (record: IndexRecord) => ItemDetails | null;

// How a source shows in the window: its name as a person knows it, such as
// "Jira", and its items' details. `linked` names the item, by its key, that a
// link into the source points at when the link isn't the item's location,
// such as a chat reply's link, which is its message's.
export type Presentation = {
  name: string;
  details: DetailsOf;
  linked?: (link: URL) => string | null;
};
export type Presentations = Partial<Record<SourceKind, Presentation>>;

// `view` builds plain view data for the web package to render, so zoom levels
// are testable without a DOM. A summarizer gets its model and reads injected
// when it is constructed.
export interface ZoomLevel<V, R extends IndexRecord = IndexRecord> {
  readonly id: ZoomId;
  view(cluster: Cluster, records: readonly R[]): V;
  summarize?(cluster: Cluster, records: readonly R[]): Promise<Summary>;
}
