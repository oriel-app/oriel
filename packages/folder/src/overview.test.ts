import assert from "node:assert/strict";
import { test } from "node:test";
import type { IndexRecord, Instant } from "@oriel/core";
import { folderOverview } from "./overview.ts";

const now = "2026-10-30T12:00:00.000Z" as Instant;

const file = (name: string, updatedAt: string): IndexRecord => ({
  id: `folder:${name}`,
  stableId: name,
  title: name,
  location: `file:///notes/${name}.md`,
  updatedAt: updatedAt as Instant,
  facets: { kind: "doc" },
  attrs: {},
});

test("a file edited in the last 7 days that no workstream holds is a candidate", () => {
  const records = [
    file("fresh", "2026-10-24T12:00:01.000Z"),
    file("old", "2026-10-23T12:00:00.000Z"),
    file("held", "2026-10-29T12:00:00.000Z"),
    // A clock behind the folder's puts an edit after now: still this week.
    file("ahead", "2026-10-31T09:00:00.000Z"),
  ];
  const found = folderOverview({
    records,
    changes: [],
    held: (record) => record.id === "folder:held",
    now,
  });
  assert.deepEqual(found, [
    { subject: { kind: "item", id: "folder:fresh" }, rule: "Edited in the last 7 days", weight: 1 },
    { subject: { kind: "item", id: "folder:ahead" }, rule: "Edited in the last 7 days", weight: 1 },
  ]);
});
