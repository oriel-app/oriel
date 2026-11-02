// Jira's candidates for the overview (decision 0027): an epic no workstream
// holds, as a cluster Make a workstream copies with its items, weighted by
// how many of its open items that no workstream holds changed this week;
// and an item in progress with no update in `stuckDays`, which has stalled.
import {
  type Candidate,
  daysSince,
  type IndexRecord,
  type OverviewOf,
  stalled,
  stuckDays,
  thisWeek,
  weights,
} from "@oriel/core";

export const jiraOverview: OverviewOf = ({ records, held, now }) => {
  const childrenOf = Map.groupBy(
    records.filter((record) => record.facets.container),
    (record) => record.facets.container?.stableId,
  );
  return records.flatMap((record): Candidate[] => {
    if (held(record)) return [];
    if (record.facets.kind === "epic") return record.facets.state === "done" ? [] : [epic(record)];
    if (!stalled(record, now)) return [];
    return [
      {
        subject: { kind: "item", id: record.id },
        rule: `In progress, no update in ${stuckDays} days`,
        weight: weights.stalled,
        detail: `${daysSince(record.updatedAt, now)} days idle`,
      },
    ];
  });

  function epic(record: IndexRecord): Candidate {
    const changed = (childrenOf.get(record.stableId) ?? []).filter(
      (child) => child.facets.state !== "done" && !held(child) && thisWeek(child.updatedAt, now),
    ).length;
    return {
      subject: { kind: "cluster", grouping: "epic", key: record.stableId },
      rule: "An epic no workstream holds",
      weight: weights.glance + changed * weights.moved,
      ...(changed > 0 && { detail: `${changed} changed this week` }),
    };
  }
};
