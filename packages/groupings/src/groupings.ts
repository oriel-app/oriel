// The phase 1 groupings of Jira items: by epic, by assignee and "stuck". A
// cluster the source has (an epic, an assignee, no epic) says so; one Oriel
// derives carries a rule, true of every item it holds and of no item it leaves
// out. Pure: `now` is passed in.
import type { Cluster, Grouping, IndexRecord, ItemId, JiraAttrs } from "@oriel/core";

export type JiraRecord = IndexRecord<"jira", JiraAttrs>;

const day = 86_400_000;

// Project, then issue number, so SYN-9 comes before SYN-10.
export function byKey(a: JiraRecord, b: JiraRecord): number {
  const [aProject, aNumber] = keyParts(a.id);
  const [bProject, bNumber] = keyParts(b.id);
  if (aProject !== bProject) return aProject < bProject ? -1 : 1;
  return aNumber - bNumber;
}

function keyParts(id: ItemId): [string, number] {
  const dash = id.lastIndexOf("-");
  return [id.slice(0, dash), Number(id.slice(dash + 1))];
}

const isEpic = (record: JiraRecord) => record.attrs.issueType === "Epic";
const ids = (records: readonly JiraRecord[]) => records.map((record) => record.id);

// One cluster per epic, keyed by its stable ID and anchored on it, holding the
// items whose epic it is. Epics are anchors, never items. An item the source
// names as an epic anchors a cluster whatever its type, so an item only lands
// in the derived cluster when its epic really isn't in the index.
export const epicGrouping: Grouping<JiraRecord> = {
  id: "epic",
  label: "Epic",
  group(records) {
    const sorted = records.toSorted(byKey);
    const named = new Set(sorted.map((record) => record.attrs.epic));
    const anchors = sorted.filter((record) => isEpic(record) || named.has(record.id));
    const anchored = new Set(ids(anchors));
    const items = sorted.filter((record) => !anchored.has(record.id));
    const byEpic = Map.groupBy(items, (item) => item.attrs.epic);
    const clusters: Cluster[] = anchors.map((epic) => ({
      key: epic.stableId,
      label: epic.title,
      anchor: epic.id,
      itemIds: ids(byEpic.get(epic.id) ?? []),
      origin: "source",
    }));
    const none = byEpic.get(null) ?? [];
    if (none.length > 0) {
      clusters.push({
        key: "no-epic",
        label: "No epic",
        anchor: null,
        itemIds: ids(none),
        origin: "source",
      });
    }
    const missing = items.filter(({ attrs }) => attrs.epic !== null && !anchored.has(attrs.epic));
    if (missing.length > 0) {
      clusters.push({
        key: "epic-not-indexed",
        label: "Epic not in the index",
        anchor: null,
        itemIds: ids(missing),
        origin: { derived: "Items whose epic isn't in the index" },
      });
    }
    return clusters;
  },
};

const names = new Intl.Collator("en");

// One cluster per assignee, by name, then the unassigned. Epics are items here.
export const assigneeGrouping: Grouping<JiraRecord> = {
  id: "assignee",
  label: "Assignee",
  group(records) {
    const people = new Map<string, { name: string; items: JiraRecord[] }>();
    const unassigned: JiraRecord[] = [];
    for (const record of records.toSorted(byKey)) {
      const { assignee } = record.attrs;
      if (assignee === null) {
        unassigned.push(record);
        continue;
      }
      const person = people.get(assignee.accountId) ?? { name: assignee.name, items: [] };
      person.items.push(record);
      people.set(assignee.accountId, person);
    }
    const clusters: Cluster[] = [...people]
      .toSorted(([a, x], [b, y]) => names.compare(x.name, y.name) || names.compare(a, b))
      .map(([accountId, person]) => ({
        // Prefixed, so no account ID can be mistaken for "unassigned".
        key: `person:${accountId}`,
        label: person.name,
        anchor: null,
        itemIds: ids(person.items),
        origin: "source",
      }));
    if (unassigned.length === 0) return clusters;
    clusters.push({
      key: "unassigned",
      label: "Unassigned",
      anchor: null,
      itemIds: ids(unassigned),
      origin: "source",
    });
    return clusters;
  },
};

// What "stuck" covers: work items, not epics, that aren't done.
const workTypes = new Set(["Story", "Task", "Bug"]);
const stuckAfter = 14 * day;

// Both clusters always show, so an empty one says nothing is stuck that way.
// "No update" lists the longest idle first.
export const stuckGrouping: Grouping<JiraRecord> = {
  id: "stuck",
  label: "Stuck",
  group(records, now) {
    const open = records
      .filter(({ attrs }) => workTypes.has(attrs.issueType) && attrs.status.category !== "done")
      .toSorted(byKey);
    const idle = open
      .filter((item) => Date.parse(now) - Date.parse(item.updatedAt) >= stuckAfter)
      .toSorted((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
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
      {
        key: "unestimated",
        label: "Unestimated",
        anchor: null,
        itemIds: ids(open.filter((item) => item.attrs.points === null)),
        origin: { derived: "Stories, tasks and bugs not done and with no story point estimate" },
      },
    ];
  },
};
