// A zoom level indexes the records it is handed once, for cluster after
// cluster, and reads the newer ones when handed others.
import assert from "node:assert/strict";
import { test } from "node:test";
import { instant } from "@oriel/core";
import { fixtureSnapshot, jiraPresentation } from "@oriel/jira";
import { loadJiraFixture } from "../../../scripts/fixtures/load.ts";
import { epicGrouping } from "./groupings.ts";
import { clusterZoom, listZoom } from "./zoom.ts";

const fixture = loadJiraFixture();
const site = "https://oriel.atlassian.net";
const current = fixtureSnapshot(fixture, site, fixture.edits.length).records;
const now = instant(new Date("2026-10-02T11:00:00.000Z"));
const sources = { jira: jiraPresentation };

test("one zoom level handed newer records reads them, not the ones it had", () => {
  const rows = clusterZoom(now, sources);
  const list = listZoom(now, sources);
  const checkout = epicGrouping.group(current, now).find((c) => c.key === "10001");
  assert.ok(checkout);
  // The same records, one of the checkout epic's items retitled since.
  const [first] = checkout.itemIds;
  const retitled = current.map((record) =>
    record.id === first ? { ...record, title: "Retitled" } : record,
  );
  const fresh = (records: typeof current) => ({
    row: clusterZoom(now, sources).view(checkout, records),
    list: listZoom(now, sources).view(checkout, records),
  });
  for (const records of [current, retitled, current])
    assert.deepEqual(
      { row: rows.view(checkout, records), list: list.view(checkout, records) },
      fresh(records),
    );
  assert.equal(list.view(checkout, retitled)[0]?.title, "Retitled");
});
