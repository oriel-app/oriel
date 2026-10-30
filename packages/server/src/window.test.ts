import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Cluster,
  type Grouping,
  type Instant,
  instant,
  itemId,
  type State,
} from "@oriel/core";
import type { JiraRecord } from "@oriel/jira";
import { fixtureIndex } from "./fixture.ts";
import { groupings, windowView } from "./window.ts";

const now: Instant = instant(new Date("2026-10-29T09:00:00.000Z"));

function record(
  key: string,
  fields: {
    issueType?: string;
    status?: { name: string; category: State };
    assignee?: { accountId: string; name: string };
    points?: number;
    updated?: string;
  } = {},
): JiraRecord {
  const { updated = "2026-10-28T09:00:00.000Z", status, assignee, issueType = "Story" } = fields;
  return {
    id: itemId("jira", key),
    stableId: key,
    title: `Title of ${key}`,
    location: `https://oriel.atlassian.net/browse/${key}`,
    updatedAt: instant(new Date(updated)),
    facets: {
      people: assignee ? [{ role: "assignee", id: assignee.accountId, name: assignee.name }] : [],
      state: status?.category ?? "todo",
      container: null,
      kind: issueType.toLowerCase(),
      estimate: fields.points ?? null,
    },
    attrs: { issueType, status: status?.name ?? "To Do", labels: [] },
  };
}

// Returns the clusters it was given, whatever the records.
function fixed(clusters: Cluster[]): Grouping {
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

test("the window says when it shows the fixtures, and the instant it was built for", () => {
  const view = windowView("epic", fixed([]), records, now, true);
  assert.equal(view.fixture, true);
  assert.equal(view.asOf, now);
});

test("the fixtures are served after every source edit, as of their last one", () => {
  const { records: indexed, now: asOf } = fixtureIndex();
  assert.equal(asOf, "2026-10-02T11:00:00.000Z");
  // SYN-27 was deleted, and SYN-88 moved to the weather epic.
  assert.equal(
    indexed.some((record) => record.id === "jira:SYN-27"),
    false,
  );
  assert.equal(
    indexed.find((record) => record.id === "jira:SYN-88")?.facets.container?.id,
    "jira:SYN-3",
  );
  for (const id of ["epic", "assignee", "stuck"] as const) {
    assert.equal(groupings[id].id, id);
    const view = windowView(id, groupings[id], indexed, asOf, true);
    assert.ok(view.clusters.length > 0, id);
    for (const { row } of view.clusters) {
      const expected = id === "stuck" ? "derived" : "source";
      assert.equal(row.origin.kind, expected, `${id}: ${row.label}`);
      if (row.origin.kind === "source") assert.equal(row.origin.source, "Jira");
    }
  }
});
