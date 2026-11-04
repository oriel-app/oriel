// Sheets' candidates for the overview (decision 0027): a picked spreadsheet
// edited in the last 7 days, and a row whose status changed in the last 7
// days, by the change log, that no workstream holds. Google keeps no time
// per row, so a row's own update time can't say it moved.
import { daysSince, type Instant, type OverviewOf, thisWeek, weights } from "@oriel/core";
import { sheetsAttrsOf } from "./attrs.ts";

const ago = (days: number, what: string) =>
  days === 0 ? `${what} today` : `${what} ${days} ${days === 1 ? "day" : "days"} ago`;

export const sheetsOverview: OverviewOf = ({ records, changes, held, now }) => {
  // When each row's status last changed, by stable ID.
  const moved = new Map<string, Instant>();
  for (const entry of changes)
    if (!entry.gone && (entry.facets.state || entry.facets.declared?.status))
      moved.set(entry.stableId, entry.at);
  return records.flatMap((record) => {
    const attrs = sheetsAttrsOf(record);
    if (!attrs || held(record)) return [];
    if (attrs.of === "spreadsheet")
      return thisWeek(record.updatedAt, now)
        ? [
            {
              subject: { kind: "item" as const, id: record.id },
              rule: "A spreadsheet edited in the last 7 days",
              weight: weights.glance,
              detail: ago(daysSince(record.updatedAt, now), "edited"),
            },
          ]
        : [];
    const at = moved.get(record.stableId);
    if (at === undefined || !thisWeek(at, now)) return [];
    return [
      {
        subject: { kind: "item" as const, id: record.id },
        rule: "A row whose status changed in the last 7 days",
        weight: weights.glance,
        detail: ago(daysSince(at, now), "changed"),
      },
    ];
  });
};
