import assert from "node:assert/strict";
import { test } from "node:test";
import { type Cluster, type IndexRecord, instant } from "@oriel/core";
import { fixtureSnapshot, jiraPresentation } from "@oriel/jira";
import { loadJiraFixture } from "../../../scripts/fixtures/load.ts";
import { epicGrouping, stuckGrouping } from "./groupings.ts";
import { clusterZoom, listZoom } from "./zoom.ts";

const fixture = loadJiraFixture();
const site = "https://oriel.atlassian.net";
const syn = fixtureSnapshot(fixture, site, 0).records;
const now = instant(new Date("2026-10-02T11:00:00.000Z"));
const sources = { jira: jiraPresentation };

// SYN as a board that takes no estimates indexes it: no estimate facet.
const unestimating: IndexRecord[] = syn.map((record) => {
  const facets = { ...record.facets };
  delete facets.estimate;
  return { ...record, facets };
});

const cluster = (clusters: Cluster[], key: string) => {
  const found = clusters.find((c) => c.key === key);
  assert.ok(found, key);
  return found;
};

test("with nothing in the index that estimates, Stuck has no Unestimated cluster", () => {
  assert.deepEqual(
    stuckGrouping.group(unestimating, now).map((c) => c.key),
    ["no-update-14-days"],
  );
  // One board that estimates is enough for it to show, holding only its items.
  const mixed = [
    ...unestimating.filter((r) => r.id !== "jira:SYN-23"),
    ...syn.filter((r) => r.id === "jira:SYN-23"),
  ];
  const clusters = stuckGrouping.group(mixed, now);
  assert.deepEqual(cluster(clusters, "unestimated").itemIds, ["jira:SYN-23"]);
});

test("an epic row and its items on a board that takes no estimates count nothing as unestimated", () => {
  const checkout = cluster(epicGrouping.group(unestimating, now), "10001");
  const row = clusterZoom(now, sources).view(checkout, unestimating);
  assert.deepEqual([row.points, row.estimated, row.unestimated], [0, 0, 0]);
  assert.equal(row.anchor?.noEstimates, true);
  const list = listZoom(now, sources).view(checkout, unestimating);
  assert.ok(list.length > 0);
  assert.ok(list.every((item) => item.noEstimates === true && item.points === null));
});

test("an item that estimates, or tracks no state at all, isn't marked as taking no estimates", () => {
  const checkout = cluster(epicGrouping.group(syn, now), "10001");
  assert.ok(
    listZoom(now, sources)
      .view(checkout, syn)
      .every((item) => !("noEstimates" in item)),
  );
  const file: IndexRecord = {
    id: "folder:0123456789abcdef0123456789abcdef",
    stableId: "0123456789abcdef0123456789abcdef",
    title: "notes.md",
    location: "file:///notes.md",
    updatedAt: now,
    facets: {},
    attrs: {},
  };
  const [row] = listZoom(now, sources).view(
    { key: "files", label: "Files", anchor: null, itemIds: [file.id], origin: "source" },
    [file],
  );
  assert.ok(row && !("noEstimates" in row));
});
