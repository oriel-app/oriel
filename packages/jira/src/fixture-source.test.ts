import assert from "node:assert/strict";
import { test } from "node:test";
import { fixtureSnapshot, type JiraAttrs, type SyncPage } from "@oriel/core";
import { loadJiraFixture } from "../../../scripts/fixtures/load.ts";
import { fixtureSource } from "./fixture-source.ts";

const fixture = loadJiraFixture();
const site = "https://oriel.atlassian.net";
const allEdits = fixture.edits.length;

async function list(cursor: string | null, edited: number, pageSize?: number) {
  const pages: SyncPage<"jira", JiraAttrs>[] = [];
  const source = fixtureSource(fixture, { site, edited, ...(pageSize ? { pageSize } : {}) });
  for await (const page of source.sync(cursor)) pages.push(page);
  return pages;
}

test("a listing is the snapshot's records, oldest update first, in pages", async () => {
  const pages = await list(null, 0, 50);
  const records = pages.flatMap((page) => page.records);
  const expected = fixtureSnapshot(fixture, site, 0).records;
  assert.equal(pages.length, Math.ceil(expected.length / 50));
  assert.deepEqual(
    records.toSorted((a, b) => a.id.localeCompare(b.id)),
    expected.toSorted((a, b) => a.id.localeCompare(b.id)),
  );
  const times = records.map((r) => r.updatedAt);
  assert.deepEqual(times, times.toSorted());
  assert.equal(pages.at(-1)?.cursor, times.at(-1));
  assert.ok(pages.every((page) => page.gone.length === 0));
});

test("a cursor lists what changed at or after it, and never a deletion", async () => {
  const base = await list(null, 0);
  const cursor = base.at(-1)?.cursor ?? null;
  const changed = (await list(cursor, allEdits)).flatMap((page) => page.records);
  const keys = changed.map((r) => r.id);
  for (const edit of fixture.edits.filter((e) => e.kind !== "delete"))
    assert.ok(keys.includes(`jira:${edit.key}`), edit.key);
  const deleted = fixture.edits.find((e) => e.kind === "delete");
  assert.ok(deleted && !keys.includes(`jira:${deleted.key}`));
  assert.ok(changed.every((r) => cursor !== null && r.updatedAt >= cursor));
});

test("read returns copies of full content, and a deleted issue reads as gone", async () => {
  const deleted = fixture.edits.find((e) => e.kind === "delete");
  const renamed = fixture.edits.find((e) => e.kind === "setSummary");
  assert.ok(deleted && renamed?.kind === "setSummary");
  const source = fixtureSource(fixture, { site, edited: allEdits });
  const [first, gone] = await source.read([`jira:${renamed.key}`, `jira:${deleted.key}`]);
  assert.equal(first?.status === "ok" && first.content.summary, renamed.summary);
  assert.deepEqual(gone, { id: `jira:${deleted.key}`, status: "gone", reason: "deleted" });
  if (first?.status === "ok") first.content.labels.push("mutated");
  const [again] = await source.read([`jira:${renamed.key}`]);
  assert.ok(again?.status === "ok" && !again.content.labels.includes("mutated"));
});
