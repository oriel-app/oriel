import assert from "node:assert/strict";
import { test } from "node:test";
import { type Cluster, instant } from "@oriel/core";
import { fixtureSnapshot } from "@oriel/jira";
import { loadJiraFixture } from "../../../scripts/fixtures/load.ts";
import { epicGrouping, stuckGrouping } from "./groupings.ts";
import { clusterZoom, itemZoom, listZoom } from "./zoom.ts";

const fixture = loadJiraFixture();
const site = "https://oriel.atlassian.net";
const base = fixtureSnapshot(fixture, site, 0).records;
const current = fixtureSnapshot(fixture, site, fixture.edits.length).records;
const now = instant(new Date("2026-10-02T11:00:00.000Z"));

const cluster = (clusters: Cluster[], key: string) => {
  const found = clusters.find((c) => c.key === key);
  assert.ok(found, key);
  return found;
};

test("the epic row counts and sums its epic's items, and names their source", () => {
  // Checkout, after SYN-88 moved out of it.
  const checkout = cluster(epicGrouping.group(current, now), "10001");
  const row = clusterZoom(now).view(checkout, current);
  assert.deepEqual(
    { ...row, anchor: row.anchor?.key },
    {
      key: "10001",
      label: "Checkout v2: phone wallets and saved cards",
      origin: { kind: "source", source: "Jira" },
      anchor: "SYN-1",
      count: 13,
      points: 29,
      unestimated: 3,
      status: { todo: 4, "in-progress": 4, done: 5 },
    },
  );
  const none = clusterZoom(now).view(cluster(epicGrouping.group(current, now), "no-epic"), current);
  assert.deepEqual(none.origin, { kind: "source", source: "Jira" });
  assert.equal(none.anchor, null);
});

test("a derived row carries its rule, and its story list agrees with it", () => {
  const idle = cluster(stuckGrouping.group(current, now), "no-update-14-days");
  const row = clusterZoom(now).view(idle, current);
  assert.deepEqual(row.origin, {
    kind: "derived",
    rule: "Not done and idle 14 or more days; from Jira, only stories, tasks and bugs",
  });
  const list = listZoom(now).view(idle, current);
  assert.equal(list.length, row.count);
  assert.ok(list.every((item) => item.idleDays >= 14 && item.status.category !== "done"));
  // The longest idle first.
  const days = list.map((item) => item.idleDays);
  assert.deepEqual(
    days,
    days.toSorted((a, b) => b - a),
  );
});

test("the story list keeps the cluster's order and skips IDs the index no longer has", () => {
  // The boarding epic as grouped before SYN-27 was deleted.
  const boarding = cluster(epicGrouping.group(base, now), "10002");
  assert.ok(boarding.itemIds.includes("jira:SYN-27"));
  const list = listZoom(now).view(boarding, current);
  assert.deepEqual(
    list.map((item) => item.id),
    boarding.itemIds.filter((id) => id !== "jira:SYN-27"),
  );
  assert.equal(clusterZoom(now).view(boarding, current).count, list.length);
});

test("the item view shows what the index has, with the epic by title", () => {
  const weather = cluster(epicGrouping.group(current, now), "10003");
  const [moved] = itemZoom(now).view({ ...weather, itemIds: ["jira:SYN-88"] }, current);
  assert.deepEqual(moved, {
    id: "jira:SYN-88",
    key: "SYN-88",
    title: "Refund to the original payment method when a sailing is cancelled",
    type: "Story",
    status: { name: "To Do", category: "todo" },
    assignee: "Esme Whitlock",
    points: 5,
    idleDays: 1,
    source: "Jira",
    url: "https://oriel.atlassian.net/browse/SYN-88",
    labels: ["payments", "refunds"],
    epic: { id: "jira:SYN-3", key: "SYN-3", title: "Weather disruptions and rebooking" },
    updatedAt: "2026-10-01T11:00:00.000Z",
  });
  // Without the epic in the index, the item still names it, untitled.
  const without = current.filter((record) => record.id !== "jira:SYN-3");
  const [orphan] = itemZoom(now).view({ ...weather, itemIds: ["jira:SYN-88"] }, without);
  assert.deepEqual(orphan?.epic, { id: "jira:SYN-3", key: "SYN-3", title: null });
  const loose = cluster(epicGrouping.group(current, now), "no-epic");
  assert.ok(
    itemZoom(now)
      .view(loose, current)
      .every((item) => item.epic === null),
  );
});
