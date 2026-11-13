import assert from "node:assert/strict";
import { test } from "node:test";
import { instant, itemOrder } from "@oriel/core";
import { fixtureSnapshot, jiraPresentation, loadJiraFixture } from "@oriel/jira";
import { epicGrouping } from "./groupings.ts";
import { clusterRowOf } from "./rows.ts";

const order = itemOrder(["jira", "folder", "slack"]);

const fixture = loadJiraFixture();
const site = "https://oriel.atlassian.net";
const current = fixtureSnapshot(fixture, site, fixture.edits.length).records;
const now = instant(new Date("2026-10-02T11:00:00.000Z"));
const sources = { jira: jiraPresentation };

// Defect fixed in abdf6d4f: the row's size left out the epic that Make workstream holds.
test("a cluster row's size counts what Make workstream holds, its epic too", () => {
  const clusters = epicGrouping.group(current, now, order);
  const checkout = clusters.find((c) => c.key === "10001");
  const none = clusters.find((c) => c.key === "no-epic");
  assert.ok(checkout && none);
  const row = clusterRowOf(now, sources)(checkout, current);
  assert.equal(row.size, row.count + 1);
  const unanchored = clusterRowOf(now, sources)(none, current);
  assert.equal(unanchored.size, unanchored.count);
});
