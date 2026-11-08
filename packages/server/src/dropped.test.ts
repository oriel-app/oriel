import assert from "node:assert/strict";
import { test } from "node:test";
import type { IndexRecord, Instant, ItemId } from "@oriel/core";
import { sources } from "@oriel/sources";
import { resolveDropped } from "./dropped.ts";

const changed = "2026-10-30T00:00:00.000Z";
const at = Date.parse(changed);

const record = (id: ItemId, location: string): IndexRecord => ({
  id,
  stableId: id,
  title: id,
  location,
  updatedAt: changed as Instant,
  facets: {},
  attrs: null,
});

const records = [
  record("jira:OA-5", "https://oriel.atlassian.net/browse/OA-5"),
  record("folder:00000000000000a1", "file:///notes/plans/q3-launch.md"),
];

test("a file is refused as not in the connected folder, or as having no folder to be in", () => {
  const why = (from: readonly IndexRecord[]) =>
    resolveDropped(from, { links: [], files: [{ name: "elsewhere.md", modified: at }] }, sources)
      .refused[0];
  assert.deepEqual([why(records)?.what, why(records)?.syncMightHelp], ["elsewhere.md", true]);
  // OA-168: with no folder connected, a sync can't help, and it isn't offered.
  const jira = records.filter((r) => r.id.startsWith("jira:"));
  for (const from of [jira, []])
    assert.deepEqual([why(from)?.what, why(from)?.syncMightHelp], ["elsewhere.md", false]);
});
