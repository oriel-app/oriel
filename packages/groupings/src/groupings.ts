// The phase 1 groupings: by epic, by assignee and "stuck". They work from
// core's facets, so they span sources; a rule that needs a source's own
// fields reads them through its adapter and applies only to that source's
// items (decision 0019). A cluster the source has (an epic, an assignee, no
// epic) says so; one Oriel derives carries a rule, true of every item it
// holds and of no item it leaves out. Pure: `now` is passed in.
import {
  type Cluster,
  type Grouping,
  type IndexRecord,
  type ItemId,
  parseItemId,
  sourceKinds,
} from "@oriel/core";
import { jiraAttrsOf } from "@oriel/jira";

const day = 86_400_000;

// Source, then for Jira project and issue number (so SYN-9 comes before
// SYN-10), and otherwise the key: a total order in every locale.
export function byKey(a: IndexRecord, b: IndexRecord): number {
  const [aSource, aProject, aNumber] = keyParts(a.id);
  const [bSource, bProject, bNumber] = keyParts(b.id);
  if (aSource !== bSource) return aSource - bSource;
  if (aProject !== bProject) return aProject < bProject ? -1 : 1;
  return aNumber - bNumber;
}

function keyParts(id: ItemId): [number, string, number] {
  const parsed = parseItemId(id);
  const source = parsed ? sourceKinds.indexOf(parsed.source) : sourceKinds.length;
  const key = parsed?.key ?? id;
  if (parsed?.source !== "jira") return [source, key, 0];
  const dash = key.lastIndexOf("-");
  return [source, key.slice(0, dash), Number(key.slice(dash + 1))];
}

// An item's identity: its source and stable ID. Handles can change.
const identity = (id: ItemId, stableId: string) =>
  `${parseItemId(id)?.source ?? ""}\u0000${stableId}`;
const ids = (records: readonly IndexRecord[]) => records.map((record) => record.id);

// Jira marks an epic by its type, so an epic with no stories is still one.
const isJiraEpic = (record: IndexRecord) => jiraAttrsOf(record)?.issueType === "Epic";

// One cluster per container (an epic), keyed by its stable ID and anchored on
// it, holding the items it contains. Containers are anchors, never items. An
// item another names as its container anchors a cluster whatever its type, so
// an item only lands in the derived cluster when its container really isn't
// in the index. An item whose source has no containers has no epic.
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
      (record) => isJiraEpic(record) || named.has(identity(record.id, record.stableId)),
    );
    const anchored = new Set(anchors.map((record) => identity(record.id, record.stableId)));
    const items = sorted.filter((record) => !anchored.has(identity(record.id, record.stableId)));
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
    return clusters;
  },
};

const names = new Intl.Collator("en");

// The person in the "assignee" role, if any.
export function assigneeOf(record: IndexRecord): { id: string; name: string } | null {
  return record.facets.people?.find((person) => person.role === "assignee") ?? null;
}

// One cluster per assignee, by name, then the unassigned. Epics are items here.
export const assigneeGrouping: Grouping = {
  id: "assignee",
  label: "Assignee",
  group(records) {
    const people = new Map<string, { name: string; items: IndexRecord[] }>();
    const unassigned: IndexRecord[] = [];
    for (const record of records.toSorted(byKey)) {
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

// Jira's work items: stories, tasks and bugs, not epics or sub-tasks.
const jiraWorkTypes = new Set(["Story", "Task", "Bug"]);
const stuckAfter = 14 * day;

// Work that isn't done: an item with a state other than done, and from Jira
// only a story, task or bug. An item whose source tracks no state isn't work.
const isOpenWork = (record: IndexRecord) => {
  const { state } = record.facets;
  if (state === undefined || state === "done") return false;
  const jira = jiraAttrsOf(record);
  return parseItemId(record.id)?.source !== "jira" || jiraWorkTypes.has(jira?.issueType ?? "");
};

// Both clusters always show, so an empty one says nothing is stuck that way.
// "No update" lists the longest idle first. "Unestimated" is Jira's rule:
// only Jira items have story points.
export const stuckGrouping: Grouping = {
  id: "stuck",
  label: "Stuck",
  group(records, now) {
    const open = records.filter(isOpenWork).toSorted(byKey);
    const idle = open
      .filter((item) => Date.parse(now) - Date.parse(item.updatedAt) >= stuckAfter)
      .toSorted((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
    const unestimated = open.filter((item) => jiraAttrsOf(item)?.points === null);
    return [
      {
        key: "no-update-14-days",
        label: "No update in 14 days",
        anchor: null,
        itemIds: ids(idle),
        origin: {
          derived:
            "Items not done and last updated 14 or more days ago; from Jira, only stories, tasks and bugs",
        },
      },
      {
        key: "unestimated",
        label: "Unestimated",
        anchor: null,
        itemIds: ids(unestimated),
        origin: {
          derived: "Jira stories, tasks and bugs not done and with no story point estimate",
        },
      },
    ];
  },
};
