import { createHash } from "node:crypto";
import {
  type Cluster,
  type Grouping,
  type IndexRecord,
  type Instant,
  parseItemId,
} from "@oriel/core";
import { matchesSearch, searchTerms } from "@oriel/db";
import {
  assigneeGrouping,
  assigneeOf,
  clusterZoom,
  epicGrouping,
  listZoom,
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

// The items a filter keeps (decision 0027): every search term in the key or
// title, as search() matches; the source; the status category; the assignee;
// none an open workstream holds (`held`). Null when nothing is filtered.
export type Keep = (record: IndexRecord) => boolean;
export function keepOf(
  filter: BrowseFilter,
  held: () => Keep,
  prefixes: ReadonlySet<string>,
): Keep | null {
  const { terms } = searchTerms(filter.q ?? "", prefixes);
  const { q, source, status, assignee, workstream } = filter;
  if (!q && !source && !status && !assignee && !workstream) return null;
  // Only a filter that asks reads what the workstreams hold.
  const holds = workstream ? held() : () => false;
  // A query with no terms, such as "jira:" alone, finds nothing, as with
  // search().
  return (record) =>
    (!q || (terms.length > 0 && matchesSearch(record, terms))) &&
    (!source || parseItemId(record.id)?.kind === source) &&
    (!status || record.facets.state === status) &&
    (!assignee || assigneeOf(record)?.id === assignee) &&
    (!workstream || !holds(record));
}

// What the filters can pick from: the sources the index has items from, in
// their usual order, and the people assigned an item, by name.
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

// Where each of `rows` lives in its source, for an http(s) location only.
function locations(rows: readonly ItemRow[], records: readonly IndexRecord[]) {
  const ids = new Set(rows.map((row) => row.id));
  return Object.fromEntries(
    records.flatMap((record) => {
      const url = ids.has(record.id) ? webUrl(record.location) : null;
      return url ? [[record.id, url]] : [];
    }),
  );
}

// The clusters as rows, each with its items as the list zoom level shows
// them, or with none: Browse loads a cluster's items when it opens, a page
// at a time (decision 0027).
function clustersView(
  id: GroupingId,
  clusters: readonly Cluster[],
  records: readonly IndexRecord[],
  now: Instant,
  fixture: boolean,
  withItems: boolean,
): WindowView {
  const rows = clusterZoom(now, sources);
  const list = listZoom(now, sources);
  const known = new Set(records.map((record) => record.id));
  const shown = clusters.map((cluster) => ({
    row: rows.view(cluster, records),
    list: withItems ? list.view(cluster, records) : [],
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

// The whole grouped list in one reply, every cluster with all its items.
export function windowView(
  id: GroupingId,
  grouping: Grouping,
  records: readonly IndexRecord[],
  now: Instant,
  fixture: boolean,
): WindowView {
  return clustersView(id, grouping.group(records, now, byItemId), records, now, fixture, true);
}

// Browse's first reply: the clusters as rows, with no items yet. Under a
// filter, only the clusters with an item or an anchor it keeps, each saying
// how many of its items it keeps; `items` counts those.
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
    return record !== undefined && keep(record);
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

// One page of a cluster's items, from the `from`th, as the list zoom level
// shows them, only those a filter keeps; null when the grouping has no
// cluster with that key now.
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
  const present = cluster.itemIds.filter((item) => {
    const record = known.get(item);
    return record !== undefined && (!keep || keep(record));
  });
  const page = { ...cluster, itemIds: present.slice(from, from + pageSize) };
  const items = listZoom(now, sources).view(page, records);
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
