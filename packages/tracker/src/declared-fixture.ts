import { type Instant, type ItemId, listed, type SourceFixture } from "@oriel/core";
import { idOf, type Issue, issuesIn } from "./issues.ts";
import { memoryItems } from "./memory.ts";
import { openTracker, type TrackerOn, type TrackerWrites } from "./open-connection.ts";
import { trackerSource } from "./source.ts";

const planned = "2026-10-28T10:00:00.000Z" as Instant;

const plan: Issue[] = [
  {
    key: "T-1",
    kind: "epic",
    summary: "Spring launch",
    description: "Get the new plans in front of customers by April.",
    status: "In progress",
    epic: null,
    assignee: null,
    points: null,
    labels: ["launch"],
    updatedAt: planned,
  },
  ...(
    [
      [
        "T-2",
        "Pricing page",
        "Three tiers, with the yearly discount.",
        "In progress",
        "Ada Quill",
        3,
      ],
      ["T-3", "Launch email", "To everyone on the waitlist.", "To do", null, null],
      ["T-4", "Support macros", "Answers to the five questions we expect.", "To do", null, null],
    ] as const
  ).map(([key, summary, description, status, assignee, points]): Issue => ({
    key,
    kind: "story",
    summary,
    description,
    status,
    epic: { id: idOf("T-1"), stableId: "1" },
    assignee,
    points,
    labels: [],
    updatedAt: planned,
  })),
];

async function stored(edited: number) {
  const own = memoryItems();
  if (edited > 0)
    await issuesIn(own).put({ by: "change-set", change: "created", fields: [] }, plan);
  return own;
}

export const trackerDeclaredFixture: SourceFixture<TrackerOn, undefined, TrackerWrites> = {
  load: () => ({
    edits: 1,
    firstEdit: null,
    regions: [],
    item: (name) =>
      plan.some((issue) => issue.key === name)
        ? { id: idOf(name) }
        : { problem: `the tracker fixture has no ${JSON.stringify(name)}` },
    chips: (edited) =>
      edited > 0 ? plan.map((issue) => [idOf(issue.key), issue.summary] as const) : [],
    connect: async (edited) => {
      const own = await stored(edited);
      const source = trackerSource(own);
      const { records, texts } = await listed(source.sync(null));
      return {
        records,
        texts,
        read: (ids) => source.read(ids as ItemId<"tracker">[]),
        context: { on: true },
        changes: () => [],
        close: () => {},
      };
    },
  }),
  connection: () => ({ identity: "oriel", options: {} }),
  open: (connection, via) =>
    openTracker(connection, via.own ? via : { ...via, own: memoryItems() }),
};
