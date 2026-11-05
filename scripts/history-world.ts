// SYN with eight weeks behind it, for the chart blocks' screenshots: the
// fixture as it stood on Monday Sep 7, then a week's moves at a time
// (packages/evals/src/past-weeks.ts), each synced on its Monday, so the
// change log holds what a real team's would and every chart is drawn from
// it. No fixture file changes.
import { instant, type Instant } from "../packages/core/src/ids.ts";
import type { State } from "../packages/core/src/source.ts";
import { type Moves, pastOf, pastWeeks } from "../packages/evals/src/past-weeks.ts";
import type { JiraFixture } from "../packages/jira/src/fixture.ts";

export const weeks = pastWeeks;
const firstMonday = Date.parse("2026-09-07T09:00:00.000Z");
export const weekAt = (k: number): Instant => instant(new Date(firstMonday + k * 7 * 86_400_000));

const names: Record<State, { name: string; category: State }> = {
  todo: { name: "To Do", category: "todo" },
  "in-progress": { name: "In Progress", category: "in-progress" },
  done: { name: "Done", category: "done" },
};

// The fixture as it stood before the first week, and each week's moves by
// Jira's status names.
export function history(fixture: JiraFixture): {
  start: JiraFixture;
  moves: Map<number, [string, string][]>;
} {
  const { start, moves } = pastOf(
    fixture.issues.map((issue) => ({
      key: issue.key,
      kind: issue.issueType === "Epic" ? "epic" : issue.issueType.toLowerCase(),
      state: issue.status.category,
      epic: issue.epic,
    })),
  );
  const named = (all: Moves) =>
    new Map(
      [...all].map(([k, list]) => [
        k,
        list.map(([key, state]): [string, string] => [key, names[state].name]),
      ]),
    );
  return {
    start: {
      ...fixture,
      issues: fixture.issues.map((issue) => ({
        ...issue,
        status: names[start.get(issue.key) ?? issue.status.category],
      })),
    },
    moves: named(moves),
  };
}
