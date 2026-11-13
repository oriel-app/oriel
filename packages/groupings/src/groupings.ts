import {
  type Cluster,
  type Grouping,
  type IndexRecord,
  type ItemId,
  type ItemOrder,
  parseItemId,
  stuckDays,
} from "@oriel/core";

const day = 86_400_000;

export const byKey =
  (order: ItemOrder) =>
  (a: IndexRecord, b: IndexRecord): number =>
    order(a.id, b.id);

// Identity is the connection and stable ID: handles can change.
const identity = (id: ItemId, stableId: string) =>
  `${parseItemId(id)?.prefix ?? ""}\u0000${stableId}`;
const ids = (records: readonly IndexRecord[]) => records.map((record) => record.id);

export const epicGrouping: Grouping = {
  id: "epic",
  label: "Epic",
  group(records, _now, order) {
    const sorted = records.toSorted(byKey(order));
    const containerOf = (record: IndexRecord) => {
      const container = record.facets.container ?? null;
      return container && identity(container.id, container.stableId);
    };
    const named = new Set(sorted.map(containerOf));
    const anchors = sorted.filter(
      (record) => record.facets.kind === "epic" || named.has(identity(record.id, record.stableId)),
    );
    const anchored = new Set(anchors.map((record) => identity(record.id, record.stableId)));
    const rest = sorted.filter((record) => !anchored.has(identity(record.id, record.stableId)));
    const sourceless = rest.filter((record) => record.facets.container === undefined);
    const items = rest.filter((record) => record.facets.container !== undefined);
    const byContainer = Map.groupBy(items, containerOf);
    const clusters: Cluster[] = anchors.map((epic) => ({
      key: epic.stableId,
      label: epic.title,
      anchor: epic.id,
      itemIds: ids(byContainer.get(identity(epic.id, epic.stableId)) ?? []),
      origin: "source",
    }));
    const none = byContainer.get(null) ?? [];
    if (none.length > 0) {
      clusters.push({
        key: "no-epic",
        label: "No epic",
        anchor: null,
        itemIds: ids(none),
        origin: "source",
      });
    }
    const missing = items.filter((item) => {
      const container = containerOf(item);
      return container !== null && !anchored.has(container);
    });
    if (missing.length > 0) {
      clusters.push({
        key: "epic-not-indexed",
        label: "Epic not in the index",
        anchor: null,
        itemIds: ids(missing),
        origin: { derived: "Items whose epic isn't in the index" },
      });
    }
    if (sourceless.length > 0) {
      clusters.push({
        key: "no-epics-in-source",
        label: "No epics in this source",
        anchor: null,
        itemIds: ids(sourceless),
        origin: { derived: "Items from sources that have no epics" },
      });
    }
    return clusters;
  },
};

const names = new Intl.Collator("en");

export function assigneeOf(record: IndexRecord): { id: string; name: string } | null {
  return record.facets.people?.find((person) => person.role === "assignee") ?? null;
}

export const assigneeGrouping: Grouping = {
  id: "assignee",
  label: "Assignee",
  group(records, _now, order) {
    const people = new Map<string, { name: string; items: IndexRecord[] }>();
    const unassigned: IndexRecord[] = [];
    const sourceless: IndexRecord[] = [];
    for (const record of records.toSorted(byKey(order))) {
      if (record.facets.people === undefined) {
        sourceless.push(record);
        continue;
      }
      const assignee = assigneeOf(record);
      if (assignee === null) {
        unassigned.push(record);
        continue;
      }
      const person = people.get(assignee.id) ?? { name: assignee.name, items: [] };
      person.items.push(record);
      people.set(assignee.id, person);
    }
    const clusters: Cluster[] = [...people]
      .toSorted(([a, x], [b, y]) => names.compare(x.name, y.name) || names.compare(a, b))
      .map(([id, person]) => ({
        // Prefixed, so no person's ID can be mistaken for "unassigned".
        key: `person:${id}`,
        label: person.name,
        anchor: null,
        itemIds: ids(person.items),
        origin: "source",
      }));
    if (unassigned.length > 0)
      clusters.push({
        key: "unassigned",
        label: "Unassigned",
        anchor: null,
        itemIds: ids(unassigned),
        origin: "source",
      });
    if (sourceless.length > 0)
      clusters.push({
        key: "no-assignees-in-source",
        label: "No assignees in this source",
        anchor: null,
        itemIds: ids(sourceless),
        origin: { derived: "Items from sources that have no assignees" },
      });
    return clusters;
  },
};

const workKinds = new Set(["story", "task", "bug"]);
const stuckAfter = stuckDays * day;

const isOpenWork = (record: IndexRecord) =>
  workKinds.has(record.facets.kind ?? "") &&
  record.facets.state !== undefined &&
  record.facets.state !== "done";

export const stuckGrouping: Grouping = {
  id: "stuck",
  label: "Stuck",
  group(records, now, order) {
    const open = records.filter(isOpenWork).toSorted(byKey(order));
    const idle = open
      .filter((item) => Date.parse(now) - Date.parse(item.updatedAt) >= stuckAfter)
      .toSorted((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
    const estimates = records.some((item) => item.facets.estimate !== undefined);
    const unestimated = open.filter((item) => item.facets.estimate === null);
    return [
      {
        key: "no-update-14-days",
        label: "No update in 14 days",
        anchor: null,
        itemIds: ids(idle),
        origin: {
          derived: "Stories, tasks and bugs not done and last updated 14 or more days ago",
        },
      },
      ...(estimates
        ? [
            {
              key: "unestimated",
              label: "Unestimated",
              anchor: null,
              itemIds: ids(unestimated),
              origin: { derived: "Stories, tasks and bugs not done and with no estimate" },
            },
          ]
        : []),
    ];
  },
};

export const linkedGrouping: Grouping = {
  id: "linked",
  label: "Linked",
  group(records, _now, order) {
    const sorted = records.toSorted(byKey(order));
    const live = new Map(sorted.map((record) => [identity(record.id, record.stableId), record]));
    const named = (record: IndexRecord) =>
      (record.facets.references ?? []).flatMap(
        (to) => live.get(identity(to.id, to.stableId)) ?? [],
      );
    const naming = new Map<IndexRecord, IndexRecord[]>();
    for (const record of sorted)
      for (const to of named(record)) {
        const from = naming.get(to) ?? [];
        from.push(record);
        naming.set(to, from);
      }
    return [...naming]
      .map(([anchor, from]): Cluster => {
        const linked = [...new Set([...from, ...named(anchor)])].filter((r) => r !== anchor);
        return {
          key: `${parseItemId(anchor.id)?.prefix ?? ""}:${anchor.stableId}`,
          label: anchor.title,
          anchor: null,
          itemIds: ids([anchor, ...linked]),
          origin: { derived: "Items that name it, or that it names" },
        };
      })
      .toSorted(
        (a, b) =>
          b.itemIds.length - a.itemIds.length || order(a.itemIds[0] ?? "", b.itemIds[0] ?? ""),
      );
  },
};
