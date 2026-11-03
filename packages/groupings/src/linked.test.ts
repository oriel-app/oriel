import assert from "node:assert/strict";
import { test } from "node:test";
import { type IndexRecord, instant, type ItemId, itemOrder } from "@oriel/core";
import { linkedGrouping } from "./groupings.ts";

// Item IDs in declared kind order, as the composition root gives it.
const order = itemOrder(["jira", "folder", "slack"]);

const at = instant(new Date(Date.UTC(2026, 9, 29)));
const item = (id: ItemId, references: ItemId[] = []): IndexRecord => ({
  id,
  stableId: `s-${id}`,
  title: `Title of ${id}`,
  location: "https://example.invalid/",
  updatedAt: at,
  facets: references.length
    ? { references: references.map((to) => ({ id: to, stableId: `s-${to}` })) }
    : {},
  attrs: {},
});

test("each item another names anchors a cluster of what names it and what it names", () => {
  const records = [
    item("jira:SYN-54", ["jira:SYN-3"]),
    item("jira:SYN-3"),
    item("jira:SYN-9"),
    item("slack:C0FW1WEATHR-1788444000.000100", ["jira:SYN-54"]),
    item("slack:C0FW1WEATHR-1788344100.000100", ["jira:SYN-54", "jira:SYN-77"]),
  ];
  const clusters = linkedGrouping.group(records, at, order);
  assert.deepEqual(clusters, [
    {
      key: "jira:s-jira:SYN-54",
      label: "Title of jira:SYN-54",
      anchor: null,
      itemIds: [
        "jira:SYN-54",
        "slack:C0FW1WEATHR-1788344100.000100",
        "slack:C0FW1WEATHR-1788444000.000100",
        "jira:SYN-3",
      ],
      origin: { derived: "Items that name it, or that it names" },
    },
    {
      key: "jira:s-jira:SYN-3",
      label: "Title of jira:SYN-3",
      anchor: null,
      itemIds: ["jira:SYN-3", "jira:SYN-54"],
      origin: { derived: "Items that name it, or that it names" },
    },
  ]);
  // A reference is never a hierarchy: no cluster comes from the source, and
  // none hangs off an item.
  assert.ok(clusters.every((cluster) => cluster.origin !== "source" && cluster.anchor === null));
});

test("nothing linked, no clusters; a reference to an item not in the index anchors none", () => {
  assert.deepEqual(linkedGrouping.group([item("jira:SYN-1", ["jira:SYN-2"])], at, order), []);
});
