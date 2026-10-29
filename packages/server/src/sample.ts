// TEMPORARY. Delete this file when `fixtures/jira/` and the real groupings
// land; they are being built on other branches. Until then the window renders
// this hand-written sample through these stand-in groupings, and says so in
// the UI (`WindowView.sample`). Every name and title here is made up.

import {
  type Cluster,
  type Grouping,
  type IndexRecord,
  type Instant,
  type JiraAttrs,
  instant,
  itemId,
} from "@oriel/core";
import type { GroupingId } from "@oriel/web/view";

export type JiraRecord = IndexRecord<"jira", JiraAttrs>;

// The sample's clock: stuck rules count back from here, so the view is stable.
export const sampleNow: Instant = instant(new Date("2026-10-29T09:00:00.000Z"));

const people = {
  ana: { accountId: "sample-ana", name: "Ana Ruiz" },
  ben: { accountId: "sample-ben", name: "Ben Okafor" },
  chen: { accountId: "sample-chen", name: "陈伟" },
  dana: { accountId: "sample-dana", name: "Dana Kim" },
  eli: { accountId: "sample-eli", name: "Eli Novak" },
};

const statuses = {
  todo: { name: "To Do", category: "todo" },
  doing: { name: "In Progress", category: "in-progress" },
  review: { name: "In Review", category: "in-progress" },
  done: { name: "Done", category: "done" },
} satisfies Record<string, JiraAttrs["status"]>;

function record(
  n: number,
  title: string,
  attrs: {
    type?: string;
    status: keyof typeof statuses;
    epic?: number;
    who?: keyof typeof people;
    points?: number;
    // Days before `sampleNow`.
    idle: number;
  },
): JiraRecord {
  const key = `SYN-${n}`;
  return {
    id: itemId("jira", key),
    stableId: String(10_000 + n),
    title,
    url: `https://oriel.atlassian.net/browse/${key}`,
    updatedAt: instant(new Date(Date.parse(sampleNow) - attrs.idle * 86_400_000 - 3_600_000)),
    attrs: {
      issueType: attrs.type ?? "Story",
      status: statuses[attrs.status],
      epic: attrs.epic === undefined ? null : itemId("jira", `SYN-${attrs.epic}`),
      assignee: attrs.who ? people[attrs.who] : null,
      points: attrs.points ?? null,
      labels: [],
    },
  };
}

export const sampleRecords: readonly JiraRecord[] = [
  record(1, "Self-serve onboarding", { type: "Epic", status: "doing", who: "ana", idle: 1 }),
  record(2, "Billing and invoices", { type: "Epic", status: "doing", who: "ben", idle: 3 }),
  record(3, "Offline mode for the mobile app", { type: "Epic", status: "todo", idle: 9 }),
  record(4, "Search relevance", { type: "Epic", status: "doing", who: "chen", idle: 2 }),
  record(5, "Accessibility pass", { type: "Epic", status: "todo", who: "dana", idle: 30 }),

  record(11, "Sign-up form with work email check", {
    status: "done",
    epic: 1,
    who: "ana",
    points: 3,
    idle: 12,
  }),
  record(12, "Workspace setup checklist", {
    status: "review",
    epic: 1,
    who: "ana",
    points: 5,
    idle: 1,
  }),
  record(13, "Invite teammates from the empty state", {
    status: "doing",
    epic: 1,
    who: "dana",
    points: 3,
    idle: 2,
  }),
  record(14, "Update copy on empty state", { status: "todo", epic: 1, who: "eli", idle: 4 }),
  record(15, "Sample project for new workspaces", {
    status: "todo",
    epic: 1,
    points: 8,
    idle: 19,
  }),
  record(16, "🚀 Launch checklist for onboarding", {
    type: "Task",
    status: "todo",
    epic: 1,
    who: "ana",
    points: 1,
    idle: 3,
  }),
  record(17, "Track time to first project", {
    status: "done",
    epic: 1,
    who: "eli",
    points: 2,
    idle: 20,
  }),

  record(21, "Invoice PDF export", { status: "done", epic: 2, who: "ben", points: 5, idle: 8 }),
  record(22, "Proration when a plan changes mid-cycle", {
    status: "doing",
    epic: 2,
    who: "ben",
    points: 8,
    idle: 16,
  }),
  record(23, "Tax IDs on invoices", { status: "todo", epic: 2, who: "dana", idle: 22 }),
  record(
    24,
    "Investigate intermittent timeouts when exporting large invoice histories to CSV from the billing page on slow connections",
    { type: "Bug", status: "review", epic: 2, who: "eli", points: 3, idle: 0 },
  ),
  record(25, "Update copy on empty state", {
    status: "todo",
    epic: 2,
    who: "ben",
    points: 1,
    idle: 5,
  }),

  record(31, "Cache the last synced project on device", {
    status: "todo",
    epic: 3,
    points: 8,
    idle: 41,
  }),
  record(32, "Conflict banner when a change syncs late", { status: "todo", epic: 3, idle: 41 }),
  record(33, "Spike: storage limits on older phones", {
    type: "Task",
    status: "done",
    epic: 3,
    who: "chen",
    points: 2,
    idle: 35,
  }),

  record(41, "検索結果の並び順を修正", {
    type: "Bug",
    status: "doing",
    epic: 4,
    who: "chen",
    points: 3,
    idle: 1,
  }),
  record(42, "Rank exact key matches first", {
    status: "done",
    epic: 4,
    who: "chen",
    points: 2,
    idle: 6,
  }),
  record(43, "Fold accents and width in search", {
    status: "review",
    epic: 4,
    who: "dana",
    points: 5,
    idle: 2,
  }),
  record(44, "Search analytics dashboard", { status: "todo", epic: 4, idle: 15 }),

  record(51, "Rotate the staging certificates", {
    type: "Task",
    status: "doing",
    who: "eli",
    points: 1,
    idle: 18,
  }),
  record(52, "Flaky checkout test on CI", { type: "Bug", status: "todo", who: "ben", idle: 2 }),
  record(53, "Quarterly access review", { type: "Task", status: "done", who: "ana", idle: 26 }),
];

const isEpic = (record: JiraRecord) => record.attrs.issueType === "Epic";
const isOpen = (record: JiraRecord) => record.attrs.status.category !== "done";
const daysBefore = (now: Instant, record: JiraRecord) =>
  (Date.parse(now) - Date.parse(record.updatedAt)) / 86_400_000;

// Stand-ins for the three phase 1 groupings. Every rule shown must be true of
// what it groups: "stuck" names the issue types it covers, and items whose epic
// isn't in the index get their own derived cluster rather than "No epic".
export const sampleGroupings: Record<GroupingId, Grouping<JiraRecord>> = {
  epic: {
    id: "epic",
    label: "Epic",
    group(records) {
      const epics = records.filter(isEpic);
      const items = records.filter((record) => !isEpic(record));
      const known = new Set(epics.map((epic) => epic.id));
      const clusters: Cluster[] = epics.map((epic) => ({
        key: epic.id,
        label: epic.title,
        anchor: epic.id,
        itemIds: items.filter((item) => item.attrs.epic === epic.id).map((item) => item.id),
        origin: "source",
      }));
      const none = items.filter((item) => item.attrs.epic === null);
      const outside = items.filter(
        (item) => item.attrs.epic !== null && !known.has(item.attrs.epic),
      );
      const extra: Cluster[] = [];
      if (none.length) {
        extra.push({
          key: "no-epic",
          label: "No epic",
          anchor: null,
          itemIds: none.map((item) => item.id),
          origin: "source",
        });
      }
      if (outside.length) {
        extra.push({
          key: "epic-outside",
          label: "Epic outside this window",
          anchor: null,
          itemIds: outside.map((item) => item.id),
          origin: {
            derived:
              "Has an epic in Jira that isn't in the index: deleted, moved or in another project",
          },
        });
      }
      return [...clusters, ...extra];
    },
  },
  assignee: {
    id: "assignee",
    label: "Assignee",
    group(records) {
      const items = records;
      const names = new Map<string, string>();
      for (const item of items) {
        if (item.attrs.assignee) names.set(item.attrs.assignee.accountId, item.attrs.assignee.name);
      }
      const clusters: Cluster[] = [...names]
        .sort(([, a], [, b]) => a.localeCompare(b))
        .map(([accountId, name]) => ({
          key: accountId,
          label: name,
          anchor: null,
          itemIds: items
            .filter((item) => item.attrs.assignee?.accountId === accountId)
            .map((item) => item.id),
          origin: "source",
        }));
      const unassigned = items.filter((item) => item.attrs.assignee === null);
      if (unassigned.length === 0) return clusters;
      return [
        ...clusters,
        {
          key: "unassigned",
          label: "Unassigned",
          anchor: null,
          itemIds: unassigned.map((item) => item.id),
          origin: "source",
        },
      ];
    },
  },
  stuck: {
    id: "stuck",
    label: "Stuck",
    group(records, now) {
      const open = records.filter((record) => !isEpic(record) && isOpen(record));
      return [
        {
          key: "idle",
          label: "No update in 14 days",
          anchor: null,
          itemIds: open.filter((item) => daysBefore(now, item) >= 14).map((item) => item.id),
          origin: {
            derived: "Stories, tasks and bugs not done and last updated 14 or more days ago",
          },
        },
        {
          key: "unestimated",
          label: "Unestimated",
          anchor: null,
          itemIds: open.filter((item) => item.attrs.points === null).map((item) => item.id),
          origin: { derived: "Stories, tasks and bugs not done and with no story points" },
        },
      ];
    },
  },
};
