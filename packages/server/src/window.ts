import { createHash } from "node:crypto";
import {
  type Cluster,
  type Grouping,
  type IndexRecord,
  type Instant,
  type ItemId,
  parseItemId,
} from "@oriel/core";
import {
  assigneeGrouping,
  assigneeOf,
  clusterItemsOf,
  clusterRowOf,
  epicGrouping,
  linkedGrouping,
  stuckGrouping,
} from "@oriel/groupings";
import { byItemId, sourceKinds, sources } from "@oriel/sources";
import {
  type BrowseFilter,
  type Choice,
  type ClusterPageView,
  type GroupingId,
  type ItemRow,
  pageSize,
  type WindowView,
} from "@oriel/web/view";
import { webUrl } from "./views.ts";

export const groupings: Record<GroupingId, Grouping> = {
  epic: epicGrouping,
  assignee: assigneeGrouping,
  stuck: stuckGrouping,
  linked: linkedGrouping,
};

export type Keep = (record: IndexRecord) => "title" | "text" | null;
export function keepOf(
  filter: BrowseFilter,
  held: () => (record: IndexRecord) => boolean,
  matches: (query: string) => ReadonlyMap<ItemId, "title" | "text">,
): Keep | null {
  const { q, source, status, assignee, workstream } = filter;
  if (!q && !source && !status && !assignee && !workstream) return null;
  const holds = workstream ? held() : () => false;
  // A query with no terms, such as "jira:" alone, finds nothing, as with
  // search().
  const found = q ? matches(q) : null;
  return (record) => {
    const kept =
      (!source || parseItemId(record.id)?.kind === source) &&
      (!status || record.facets.state === status) &&
      (!assignee || assigneeOf(record)?.id === assignee) &&
      (!workstream || !holds(record));
    if (!kept) return null;
    return found ? (found.get(record.id) ?? null) : "title";
  };
}

function choices(records: readonly IndexRecord[]): { sources: Choice[]; people: Choice[] } {
  const present = new Set<string | undefined>(
    records.map((record) => parseItemId(record.id)?.kind),
  );
  const people = new Map<string, string>();
  for (const record of records) {
    const person = assigneeOf(record);
    if (person) people.set(person.id, person.name);
  }
  return {
    sources: sourceKinds
      .filter((kind) => present.has(kind))
      .map((kind) => ({ id: kind, name: sources[kind].name })),
    people: [...people]
      .map(([id, name]) => ({ id, name }))
      .toSorted((a, b) => names.compare(a.name, b.name) || names.compare(a.id, b.id)),
  };
}

const names = new Intl.Collator("en");

function locations(rows: readonly ItemRow[], records: readonly IndexRecord[]) {
  const ids = new Set(rows.map((row) => row.id));
  return Object.fromEntries(
    records.flatMap((record) => {
      const url = ids.has(record.id) ? webUrl(record.location) : null;
      return url ? [[record.id, url]] : [];
    }),
  );
}

function clustersView(
  id: GroupingId,
  clusters: readonly Cluster[],
  records: readonly IndexRecord[],
  now: Instant,
  fixture: boolean,
  withItems: boolean,
): WindowView {
  const rowOf = clusterRowOf(now, sources);
  const itemsOf = clusterItemsOf(now, sources);
  const known = new Set(records.map((record) => record.id));
  const shown = clusters.map((cluster) => ({
    row: rowOf(cluster, records),
    list: withItems ? itemsOf(cluster, records) : [],
  }));
  return {
    grouping: id,
    clusters: shown,
    items: new Set(clusters.flatMap((cluster) => cluster.itemIds).filter((item) => known.has(item)))
      .size,
    asOf: now,
    fixture,
    locations: locations(
      shown.flatMap(({ row, list }) => [...(row.anchor ? [row.anchor] : []), ...list]),
      records,
    ),
  };
}

export function windowView(
  id: GroupingId,
  grouping: Grouping,
  records: readonly IndexRecord[],
  now: Instant,
  fixture: boolean,
): WindowView {
  return clustersView(id, grouping.group(records, now, byItemId), records, now, fixture, true);
}

export function browseView(
  id: GroupingId,
  grouping: Grouping,
  records: readonly IndexRecord[],
  now: Instant,
  fixture: boolean,
  keep: Keep | null = null,
): WindowView {
  const clusters = grouping.group(records, now, byItemId);
  const all = clustersView(id, clusters, records, now, fixture, false);
  const view = { ...all, choices: choices(records) };
  if (!keep) return view;
  const byId = new Map(records.map((record) => [record.id, record]));
  const kept = (item: string) => {
    const record = byId.get(item as IndexRecord["id"]);
    return record !== undefined && keep(record) !== null;
  };
  const shown = clusters.flatMap((cluster, at) => {
    const matched = cluster.itemIds.filter(kept);
    const anchorMatched = cluster.anchor !== null && kept(cluster.anchor);
    const view = all.clusters[at];
    if (!view || (matched.length === 0 && !anchorMatched)) return [];
    return [
      {
        cluster,
        view: { ...view, matched: matched.length, ...(anchorMatched && { anchorMatched }) },
      },
    ];
  });
  const anchors = new Set<string>(shown.flatMap(({ cluster }) => cluster.anchor ?? []));
  return {
    ...view,
    clusters: shown.map(({ view }) => view),
    items: new Set(shown.flatMap(({ cluster }) => cluster.itemIds.filter(kept))).size,
    locations: Object.fromEntries(
      Object.entries(view.locations ?? {}).filter(([item]) => anchors.has(item)),
    ),
  };
}

export function clusterPage(
  id: GroupingId,
  grouping: Grouping,
  records: readonly IndexRecord[],
  now: Instant,
  key: string,
  from: number,
  keep: Keep | null = null,
): ClusterPageView | null {
  const cluster = grouping.group(records, now, byItemId).find((each) => each.key === key);
  if (!cluster) return null;
  const known = new Map(records.map((record) => [record.id, record]));
  const kept = cluster.itemIds.flatMap((item) => {
    const record = known.get(item);
    const matched = record === undefined ? null : keep ? keep(record) : "title";
    return matched ? [{ item, matched }] : [];
  });
  const present = [
    ...kept.filter((each) => each.matched === "title"),
    ...kept.filter((each) => each.matched === "text"),
  ].map((each) => each.item);
  const page = { ...cluster, itemIds: present.slice(from, from + pageSize) };
  const items = clusterItemsOf(now, sources)(page, records);
  return {
    grouping: id,
    cluster: key,
    of: createHash("sha256").update(present.join("\n")).digest("base64url").slice(0, 16),
    from,
    items,
    total: present.length,
    locations: locations(items, records),
  };
}
