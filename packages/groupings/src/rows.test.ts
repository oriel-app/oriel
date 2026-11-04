import assert from "node:assert/strict";
import { test } from "node:test";
import { type Cluster, type IndexRecord, instant, itemOrder } from "@oriel/core";
import { fixtureSnapshot, jiraPresentation, loadJiraFixture } from "@oriel/jira";
import { epicGrouping, stuckGrouping } from "./groupings.ts";
import { clusterItemsOf, clusterRowOf } from "./rows.ts";

// Item IDs in declared kind order, as the composition root gives it.
const order = itemOrder(["jira", "folder", "slack"]);

const fixture = loadJiraFixture();
const site = "https://oriel.atlassian.net";
const base = fixtureSnapshot(fixture, site, 0).records;
const current = fixtureSnapshot(fixture, site, fixture.edits.length).records;
const now = instant(new Date("2026-10-02T11:00:00.000Z"));
const sources = { jira: jiraPresentation };

const cluster = (clusters: Cluster[], key: string) => {
  const found = clusters.find((c) => c.key === key);
  assert.ok(found, key);
  return found;
};

test("the epic row counts and sums its epic's items, and names their source", () => {
  // Checkout, after SYN-88 moved out of it.
  const checkout = cluster(epicGrouping.group(current, now, order), "10001");
  const row = clusterRowOf(now, sources)(checkout, current);
  assert.deepEqual(
    { ...row, anchor: row.anchor?.key },
    {
      key: "10001",
      label: "Checkout v2: phone wallets and saved cards",
      origin: { kind: "source", source: "Jira" },
      anchor: "SYN-1",
      count: 13,
      size: 14,
      points: 29,
      estimated: 10,
      unestimated: 3,
      status: { todo: 4, "in-progress": 4, done: 5 },
    },
  );
  const none = clusterRowOf(now, sources)(
    cluster(epicGrouping.group(current, now, order), "no-epic"),
    current,
  );
  assert.deepEqual(none.origin, { kind: "source", source: "Jira" });
  assert.equal(none.anchor, null);
  assert.equal(none.size, none.count);
});

test("a derived row carries its rule, and its story list agrees with it", () => {
  const idle = cluster(stuckGrouping.group(current, now, order), "no-update-14-days");
  const row = clusterRowOf(now, sources)(idle, current);
  assert.deepEqual(row.origin, {
    kind: "derived",
    rule: "Stories, tasks and bugs not done and last updated 14 or more days ago",
  });
  const list = clusterItemsOf(now, sources)(idle, current);
  assert.equal(list.length, row.count);
  assert.ok(
    list.every(
      (item) => item.idleDays >= 14 && item.status !== null && item.status.category !== "done",
    ),
  );
  // The longest idle first.
  const days = list.map((item) => item.idleDays);
  assert.deepEqual(
    days,
    days.toSorted((a, b) => b - a),
  );
});

test("the story list keeps the cluster's order and skips IDs the index no longer has", () => {
  // The boarding epic as grouped before SYN-27 was deleted.
  const boarding = cluster(epicGrouping.group(base, now, order), "10002");
  assert.ok(boarding.itemIds.includes("jira:SYN-27"));
  const list = clusterItemsOf(now, sources)(boarding, current);
  assert.deepEqual(
    list.map((item) => item.id),
    boarding.itemIds.filter((id) => id !== "jira:SYN-27"),
  );
  assert.equal(clusterRowOf(now, sources)(boarding, current).count, list.length);
});

test("an item whose source tracks no state isn't counted as not started", () => {
  const file: IndexRecord = {
    id: "folder:0123456789abcdef",
    stableId: "plan",
    title: "Q3 plan",
    location: "file:///notes/q3-plan.md",
    updatedAt: now,
    facets: {},
    attrs: {},
  };
  const records = [...current, file];
  const mixed: Cluster = {
    key: "mixed",
    label: "Mixed",
    anchor: null,
    itemIds: [file.id, "jira:SYN-88"],
    origin: "source",
  };
  const row = clusterRowOf(now, sources)(mixed, records);
  assert.equal(row.count, 2);
  // SYN-88 is to do; the file is in no category.
  assert.deepEqual(row.status, { todo: 1, "in-progress": 0, done: 0 });
  assert.equal(row.origin.kind === "source" && row.origin.source, "folder and Jira");
  const [listed] = clusterItemsOf(now, sources)({ ...mixed, itemIds: [file.id] }, records);
  assert.deepEqual([listed?.status, listed?.type, listed?.points], [null, "", null]);
});
