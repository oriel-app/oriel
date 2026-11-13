import assert from "node:assert/strict";
import { test } from "node:test";
import { instant, type PreviewTable, ulid } from "@oriel/core";
import { sheetsDeclaredFixture } from "./declared-fixture.ts";
import { loadSheetsFixture } from "./fixture.ts";
import { sheetsReview } from "./preview.ts";

const fixture = loadSheetsFixture();
const idOf = (slug: string) => fixture.spreadsheets.find((s) => s.slug === slug)?.id ?? "";
const tracker = idOf("tracker");
const raid = idOf("raid");
const now = instant(new Date(Date.UTC(2026, 10, 3, 9)));
const via = { log: () => {}, now: () => now };

const picked = { spreadsheets: [tracker, raid].map((id) => ({ id, tabs: [] })) };
const connection = {
  id: ulid(1, new Uint8Array(10)),
  number: 1,
  prefix: "sheets",
  identity: fixture.user.permissionId,
  options: picked,
};
const preview = () => sheetsDeclaredFixture.preview?.(connection, via) ?? Promise.resolve([]);
const trackerDraft = {
  at: `${tracker}/1100`,
  header: 1,
  end: "blank" as const,
  hidden: false,
  key: "A",
  title: "C",
  status: "D",
  states: { todo: ["To do"], "in-progress": ["In progress", "Blocked"], done: ["Done"] },
  assignee: "E",
  estimate: "F",
  link: "G",
};

const mappedNow = async (tables: PreviewTable[]) => {
  const mapped = sheetsReview.settle({ tabs: [trackerDraft] }, tables, picked);
  assert.ok(!("problem" in mapped));
  return mapped;
};

test("before it applies, a new mapping says which rows it takes from the window", async () => {
  const tables = await preview();
  const before = await mappedNow(tables);
  const said = (tab: Record<string, unknown> | null) => {
    const after = sheetsReview.settle({ tabs: tab ? [tab] : [] }, tables, before);
    assert.ok(!("problem" in after));
    return sheetsReview.said(before, after, tables);
  };
  assert.deepEqual(said({ ...trackerDraft, title: "B", assignee: undefined }), []);
  assert.deepEqual(said(trackerDraft), []);
  assert.equal(said({ ...trackerDraft, key: "C" }).length, 1);
  assert.equal(said(null).length, 1);
  assert.equal(said({ ...trackerDraft, end: "grid" }).length, 1);
  assert.deepEqual(sheetsReview.said(picked, before, tables), []);
});
