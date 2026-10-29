import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Cluster,
  type Grouping,
  type IndexRecord,
  type Instant,
  type JiraAttrs,
  instant,
  itemId,
} from "@oriel/core";
import { sampleGroupings, sampleNow, sampleRecords } from "./sample.ts";
import { windowView } from "./window.ts";

type JiraRecord = IndexRecord<"jira", JiraAttrs>;

const now: Instant = instant(new Date("2026-10-29T09:00:00.000Z"));

function record(key: string, attrs: Partial<JiraAttrs> & { updated?: string } = {}): JiraRecord {
  const { updated = "2026-10-28T09:00:00.000Z", ...rest } = attrs;
  return {
    id: itemId("jira", key),
    stableId: key,
    title: `Title of ${key}`,
    url: `https://oriel.atlassian.net/browse/${key}`,
    updatedAt: instant(new Date(updated)),
    attrs: {
      issueType: "Story",
      status: { name: "To Do", category: "todo" },
      epic: null,
      assignee: null,
      points: null,
      labels: [],
      ...rest,
    },
  };
}

// Returns the clusters it was given, whatever the records.
function fixed(clusters: Cluster[]): Grouping<JiraRecord> {
  return { id: "epic", label: "Epic", group: () => clusters };
}

const records = [
  record("SYN-1", { issueType: "Epic" }),
  record("SYN-2", { points: 3, status: { name: "Done", category: "done" } }),
  record("SYN-3", {
    points: 5,
    status: { name: "In Review", category: "in-progress" },
    assignee: { accountId: "a", name: "Ana Ruiz" },
    updated: "2026-10-10T08:00:00.000Z",
  }),
  record("SYN-4"),
];

test("the cluster zoom level counts and sums the cluster's items", () => {
  const view = windowView(
    "epic",
    fixed([
      {
        key: "jira:SYN-1",
        label: "Onboarding",
        anchor: "jira:SYN-1",
        itemIds: ["jira:SYN-2", "jira:SYN-3", "jira:SYN-4"],
        origin: "source",
      },
    ]),
    records,
    now,
    false,
  );
  const [first] = view.clusters;
  assert.ok(first);
  assert.deepEqual(
    { ...first.row, anchor: first.row.anchor?.key },
    {
      key: "jira:SYN-1",
      label: "Onboarding",
      origin: { kind: "source", source: "Jira" },
      anchor: "SYN-1",
      count: 3,
      points: 8,
      unestimated: 1,
      status: { todo: 1, "in-progress": 1, done: 1 },
    },
  );
});

test("the list zoom level shows each item's key, title, status, assignee and points", () => {
  const view = windowView(
    "epic",
    fixed([{ key: "k", label: "K", anchor: null, itemIds: ["jira:SYN-3"], origin: "source" }]),
    records,
    now,
    false,
  );
  assert.deepEqual(view.clusters[0]?.list, [
    {
      id: "jira:SYN-3",
      key: "SYN-3",
      title: "Title of SYN-3",
      type: "Story",
      status: { name: "In Review", category: "in-progress" },
      assignee: "Ana Ruiz",
      points: 5,
      idleDays: 19,
    },
  ]);
});

test("a derived cluster carries its rule", () => {
  const view = windowView(
    "stuck",
    fixed([
      {
        key: "idle",
        label: "Idle",
        anchor: null,
        itemIds: [],
        origin: { derived: "No update in 14 days" },
      },
    ]),
    records,
    now,
    false,
  );
  assert.deepEqual(view.clusters[0]?.row.origin, {
    kind: "derived",
    rule: "No update in 14 days",
  });
});

test("an ID the index lacks is skipped, and an item in two clusters counts once", () => {
  const view = windowView(
    "stuck",
    fixed([
      {
        key: "a",
        label: "A",
        anchor: null,
        itemIds: ["jira:SYN-2", "jira:SYN-99"],
        origin: "source",
      },
      { key: "b", label: "B", anchor: "jira:SYN-98", itemIds: ["jira:SYN-2"], origin: "source" },
    ]),
    records,
    now,
    false,
  );
  assert.equal(view.items, 1);
  assert.deepEqual(
    view.clusters.map(({ row, list }) => [row.count, row.anchor, list.length]),
    [
      [1, null, 1],
      [1, null, 1],
    ],
  );
});

test("the window says when it is the sample, and the instant it was built for", () => {
  const view = windowView("epic", fixed([]), records, now, true);
  assert.equal(view.sample, true);
  assert.equal(view.asOf, now);
});

// The sample is temporary; this checks it still renders through every grouping.
test("every sample grouping yields clusters of known items", () => {
  const known = new Set(sampleRecords.map((record) => record.id));
  for (const id of ["epic", "assignee", "stuck"] as const) {
    const clusters = sampleGroupings[id].group(sampleRecords, sampleNow);
    assert.ok(clusters.length > 0, id);
    for (const cluster of clusters) {
      for (const item of cluster.itemIds) assert.ok(known.has(item), `${id}: ${item}`);
      if (id === "stuck") assert.notEqual(cluster.origin, "source");
    }
  }
});
