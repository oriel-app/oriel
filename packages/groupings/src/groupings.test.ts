import assert from "node:assert/strict";
import { test } from "node:test";
import { instant, itemOrder } from "@oriel/core";
import { fixtureSnapshot, loadJiraFixture } from "@oriel/jira";
import { epicGrouping } from "./groupings.ts";

const order = itemOrder(["jira", "folder", "slack"]);

const fixture = loadJiraFixture();
const site = "https://oriel.atlassian.net";
const last = instant(new Date("2026-10-02T11:00:00.000Z"));

test("over the base, the epic grouping reproduces each frozen epic region", () => {
  const records = fixtureSnapshot(fixture, site, 0).records;
  const clusters = epicGrouping.group(records, last, order);
  const regions = fixture.regions.flatMap((region) =>
    region.origin.kind === "cluster" && region.origin.grouping === "epic"
      ? [{ ...region, origin: region.origin }]
      : [],
  );
  assert.equal(regions.length, 3);
  for (const region of regions) {
    const cluster = clusters.find((c) => c.key === region.origin.cluster);
    assert.ok(cluster, region.name);
    assert.equal(cluster.anchor, region.origin.anchor?.id);
    assert.equal(cluster.key, region.origin.anchor?.stableId);
    const ids = [cluster.anchor ?? "", ...cluster.itemIds];
    assert.deepEqual(ids.toSorted(), region.items.toSorted(), region.name);
  }
});
