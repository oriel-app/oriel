// Slack's candidates for the overview (decision 0027): a message posted in
// the last 30 days that asks something and has no reply yet.
import { daysSince, type OverviewOf, weights } from "@oriel/core";
import { slackAttrsOf } from "./attrs.ts";
import { tsInstant } from "./source.ts";

const within = 30;

export const slackOverview: OverviewOf = ({ records, held, now }) =>
  records.flatMap((record) => {
    const attrs = slackAttrsOf(record);
    if (!attrs?.asks || attrs.replies > 0 || held(record)) return [];
    // When it was posted, from its key, not when it was last edited.
    const age = daysSince(
      tsInstant(record.stableId.slice(record.stableId.lastIndexOf("-") + 1)),
      now,
    );
    if (age > within) return [];
    return [
      {
        subject: { kind: "item" as const, id: record.id },
        rule: `A question from the last ${within} days with no reply`,
        weight: weights.asks,
        detail: age === 0 ? "asked today" : `asked ${age} ${age === 1 ? "day" : "days"} ago`,
      },
    ];
  });
