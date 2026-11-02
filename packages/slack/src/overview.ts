// Slack's candidates for the overview (decision 0027): a message from the
// last 30 days that asks something and has no reply yet.
import { daysSince, type OverviewOf, weights } from "@oriel/core";
import { slackAttrsOf } from "./attrs.ts";

const within = 30;

export const slackOverview: OverviewOf = ({ records, held, now }) =>
  records.flatMap((record) => {
    const attrs = slackAttrsOf(record);
    const age = daysSince(record.updatedAt, now);
    if (!attrs?.asks || attrs.replies > 0 || age > within || held(record)) return [];
    return [
      {
        subject: { kind: "item", id: record.id },
        rule: `A question from the last ${within} days with no reply`,
        weight: weights.asks,
        detail: age === 0 ? "asked today" : `asked ${age} days ago`,
      },
    ];
  });
