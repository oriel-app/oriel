// Jira's candidates for the overview (decision 0027): an epic no workstream
// holds, as a cluster Make a workstream copies with its items, weighted by
// how many of them changed this week; and an item in progress that hasn't
// changed in 14 days, which has stalled.
import {
  type Candidate,
  daysSince,
  type IndexRecord,
  type OverviewOf,
  thisWeek,
  weights,
} from "@oriel/core";

const stalledAfter = 14;

export const jiraOverview: OverviewOf = ({ records, held, now }) => {
  const childrenOf = Map.groupBy(
    records.filter((record) => record.facets.container),
    (record) => record.facets.container?.stableId,
  );
  return records.flatMap((record): Candidate[] => {
    if (held(record)) return [];
    if (record.facets.kind === "epic") return record.facets.state === "done" ? [] : [epic(record)];
    const idle = daysSince(record.updatedAt, now);
    if (record.facets.state !== "in-progress" || idle < stalledAfter) return [];
    return [
      {
        subject: { kind: "item", id: record.id },
        rule: `In progress, no update in ${stalledAfter} days`,
        weight: weights.stalled,
        detail: `${idle} days idle`,
      },
    ];
  });

  function epic(record: IndexRecord): Candidate {
    const changed = (childrenOf.get(record.stableId) ?? []).filter((child) =>
      thisWeek(child.updatedAt, now),
    ).length;
    return {
      subject: { kind: "cluster", grouping: "epic", key: record.stableId },
      rule: "An epic no workstream holds",
      weight: weights.glance + changed * weights.moved,
      ...(changed > 0 && { detail: `${changed} changed this week` }),
    };
  }
};
