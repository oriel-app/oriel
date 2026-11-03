// The folder's candidates for the overview (decision 0027): a file edited
// in the last 7 days that no workstream holds.
import { type OverviewOf, thisWeek, weights } from "@oriel/core";

export const folderOverview: OverviewOf = ({ records, held, now }) =>
  records.flatMap((record) =>
    held(record) || !thisWeek(record.updatedAt, now)
      ? []
      : [
          {
            subject: { kind: "item" as const, id: record.id },
            rule: "Edited in the last 7 days",
            weight: weights.glance,
          },
        ],
  );
