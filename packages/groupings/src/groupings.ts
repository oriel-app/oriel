// The phase 1 groupings: by epic, by assignee and "stuck". They work from
// core's facets alone, so they span sources and know none of them (decision
// 0019). A cluster the source has (an epic, an assignee, no epic) says so;
// one Oriel derives carries a rule, true of every item it holds and of no
// item it leaves out. Pure: `now` is passed in.
import {
  byItemId,
  type Cluster,
  type Grouping,
  type IndexRecord,
  type ItemId,
  parseItemId,
} from "@oriel/core";

const day = 86_400_000;

// Records in item ID order (so SYN-9 comes before SYN-10).
export const byKey = (a: IndexRecord, b: IndexRecord): number => byItemId(a.id, b.id);

// An item's identity: its source and stable ID. Handles can change.
const identity = (id: ItemId, stableId: string) =>
  `${parseItemId(id)?.source ?? ""}\u0000${stableId}`;
const ids = (records: readonly IndexRecord[]) => records.map((record) => record.id);

// One cluster per epic: an item of kind "epic", even one with no stories, or
// one another item names as its container, whatever its kind. Each is keyed
// by its stable ID and anchored on it, holding the items it contains. Epics
// are anchors, never items, so an item only lands in the derived cluster when
// its container really isn't in the index. An item whose source has no
// containers at all (no container facet) isn't "no epic": it gets a derived
// cluster of its own, so every item shows exactly once.
export const epicGrouping: Grouping = {
  id: "epic",
  label: "Epic",
  group(records) {
    const sorted = records.toSorted(byKey);
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

// The person in the "assignee" role, if any.
export function assigneeOf(record: IndexRecord): { id: string; name: string } | null {
  return record.facets.people?.find((person) => person.role === "assignee") ?? null;
}

// One cluster per assignee, by name, then the unassigned. Epics are items here.
// An item whose source has no people (no people facet) isn't unassigned: it
// gets a derived cluster of its own.
export const assigneeGrouping: Grouping = {
  id: "assignee",
  label: "Assignee",
  group(records) {
    const people = new Map<string, { name: string; items: IndexRecord[] }>();
    const unassigned: IndexRecord[] = [];
    const sourceless: IndexRecord[] = [];
    for (const record of records.toSorted(byKey)) {
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

// What "stuck" covers: work items, not epics, sub-tasks or documents.
const workKinds = new Set(["story", "task", "bug"]);
const stuckAfter = 14 * day;

// A work item with a state other than done.
const isOpenWork = (record: IndexRecord) =>
  workKinds.has(record.facets.kind ?? "") &&
  record.facets.state !== undefined &&
  record.facets.state !== "done";

// Each cluster shows even when empty, so it says nothing is stuck that way.
// "No update" lists the longest idle first. "Unestimated" counts only items
// whose source estimates: one with no estimate facet has nothing to lack.
// When nothing in the index estimates, as with a board that takes no
// estimates, there is no such cluster at all.
export const stuckGrouping: Grouping = {
  id: "stuck",
  label: "Stuck",
  group(records, now) {
    const open = records.filter(isOpenWork).toSorted(byKey);
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
