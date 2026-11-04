import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChangeLogEntry, IndexRecord, Instant, ItemId } from "@oriel/core";
import { estimateKey, runSignalRead, type SignalInput, signalBlock, signalsOf } from "./signals.ts";

const now = "2026-10-29T09:00:00.000Z" as Instant;
const ago = (days: number) =>
  new Date(Date.parse(now) - days * 86_400_000).toISOString() as Instant;
const record = (key: string, over: Partial<IndexRecord["facets"]> = {}, days = 1): IndexRecord => ({
  id: `jira:${key}` as ItemId,
  stableId: key.slice(4),
  title: `Title of ${key}`,
  location: `https://example.atlassian.net/browse/${key}`,
  updatedAt: ago(days),
  facets: { state: "in-progress", kind: "story", container: null, ...over },
  attrs: {},
});
const epic = record("SYN-1", { kind: "epic" });
const under = { container: { id: epic.id, stableId: epic.stableId } };
const change = (
  key: string,
  facets: ChangeLogEntry["facets"],
  days: number,
  seq: number,
): ChangeLogEntry => ({
  seq,
  source: "jira",
  stableId: key.slice(4),
  version: 1,
  at: ago(days),
  facets,
  gone: false,
});
const input = (records: IndexRecord[], changes: ChangeLogEntry[] = []): SignalInput => ({
  records,
  changes,
  workstreams: [
    {
      id: "01M63E6DM0040G2081040G2081",
      name: "Checkout",
      members: records
        .filter((r) => r.facets.kind !== "message")
        .map(({ id, stableId }) => ({ id, stableId })),
    },
  ],
  threadActivity: new Map(),
  estimateKey,
  now,
});

test("a workstream quiet for 14 days stalls, and its epic is among the items behind it", () => {
  const records = [epic, record("SYN-2", under, 20), record("SYN-3", under, 30)].map((r) => ({
    ...r,
    updatedAt: ago(20),
  }));
  const [stalled] = signalsOf(input(records));
  assert.equal(stalled?.kind, "stalled");
  assert.equal(stalled?.items[0], "jira:SYN-1");
  assert.match(
    stalled?.headline ?? "",
    /^Checkout: nothing moved in 20 days, with 2 items not done$/,
  );
  assert.equal(signalsOf(input(records.map((r) => ({ ...r, updatedAt: ago(13) })))).length, 0);
});

test("estimates that rose show as a table built by Oriel from the change log, under the source's label", () => {
  const records = [
    epic,
    record("SYN-2", { ...under, estimate: 8 }),
    record("SYN-3", { ...under, estimate: 8 }),
  ];
  const changes = [
    change("SYN-2", { declared: { estimate: { before: 3, after: 8 } } }, 4, 1),
    change("SYN-3", { declared: { estimate: { before: 5, after: 8 } } }, 3, 2),
    // Older than 14 days: not this rise.
    change("SYN-3", { declared: { estimate: { before: 1, after: 5 } } }, 20, 0),
  ];
  const drift = signalsOf(input(records, changes)).find((s) => s.kind === "drift");
  assert.equal(drift?.headline, "Checkout: estimate rose from 8 to 16 in 14 days, across 2 items");
  const block = drift && signalBlock(input(records, changes), drift.block);
  assert.ok(block?.form === "table");
  assert.deepEqual(block.columns, ["Key", "Title", "Before", "After"]);
  assert.deepEqual(block.rows[0], ["SYN-2", "Title of SYN-2", 3, 8]);
});

test("a chat message naming an item after it was done is a signal; one before it isn't", () => {
  const done = record("SYN-2", { state: "done" }, 5);
  const message = (ts: string, days: number): IndexRecord => ({
    ...record(
      "SYN-9",
      { kind: "message", references: [{ id: done.id, stableId: done.stableId }] },
      days,
    ),
    id: `slack:C1-${ts}` as ItemId,
    stableId: `C1-${ts}`,
  });
  const changes = [change("SYN-2", { state: { before: "in-progress", after: "done" } }, 5, 1)];
  const found = signalsOf(input([epic, done, message("1", 2), message("2", 9)], changes));
  const contradicted = found.find((s) => s.kind === "contradicted");
  assert.equal(contradicted?.id, "contradicted:jira:SYN-2");
  assert.deepEqual(contradicted?.items, ["jira:SYN-2", "slack:C1-1"]);
});

test("an epic that gained items this week grew; a read's arguments are checked on every rerun", () => {
  const moved = ["SYN-4", "SYN-5", "SYN-6"].map((key) => record(key, under));
  const changes = moved.map((r, i) =>
    change(`SYN-${4 + i}`, { container: { before: null, after: under.container } }, 2, i + 1),
  );
  const scope = signalsOf(input([epic, record("SYN-2", under), ...moved], changes)).find(
    (s) => s.kind === "scope",
  );
  assert.equal(scope?.headline, "SYN-1 gained 3 items in 7 days, and now holds 4");
  assert.equal(runSignalRead(input([epic]), "signals.joined", ["jira:SYN-1", 365]), null);
  assert.equal(runSignalRead(input([epic]), "signals.joined", ["not an id", 7]), null);
  assert.equal(runSignalRead(input([epic]), "window.overview", []), null);
});
