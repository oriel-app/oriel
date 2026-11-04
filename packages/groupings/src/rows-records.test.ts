// A row builder indexes the records it is handed once, for cluster after
// cluster, and reads the newer ones when handed others.
import assert from "node:assert/strict";
import { test } from "node:test";
import { instant, itemOrder } from "@oriel/core";
import { fixtureSnapshot, jiraPresentation, loadJiraFixture } from "@oriel/jira";
import { epicGrouping } from "./groupings.ts";
import { clusterItemsOf, clusterRowOf } from "./rows.ts";

// Item IDs in declared kind order, as the composition root gives it.
const order = itemOrder(["jira", "folder", "slack"]);

const fixture = loadJiraFixture();
const site = "https://oriel.atlassian.net";
const current = fixtureSnapshot(fixture, site, fixture.edits.length).records;
const now = instant(new Date("2026-10-02T11:00:00.000Z"));
const sources = { jira: jiraPresentation };

test("one row builder handed newer records reads them, not the ones it had", () => {
  const rowOf = clusterRowOf(now, sources);
  const itemsOf = clusterItemsOf(now, sources);
  const checkout = epicGrouping.group(current, now, order).find((c) => c.key === "10001");
  assert.ok(checkout);
  // The same records, one of the checkout epic's items retitled since.
  const [first] = checkout.itemIds;
  const retitled = current.map((record) =>
    record.id === first ? { ...record, title: "Retitled" } : record,
  );
  const fresh = (records: typeof current) => ({
    row: clusterRowOf(now, sources)(checkout, records),
    list: clusterItemsOf(now, sources)(checkout, records),
  });
  for (const records of [current, retitled, current])
    assert.deepEqual(
      { row: rowOf(checkout, records), list: itemsOf(checkout, records) },
      fresh(records),
    );
  assert.equal(itemsOf(checkout, retitled)[0]?.title, "Retitled");
});
