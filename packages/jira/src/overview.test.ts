import assert from "node:assert/strict";
import { test } from "node:test";
import type { Facets, IndexRecord, Instant } from "@oriel/core";
import { jiraOverview } from "./overview.ts";

const now = "2026-10-30T12:00:00.000Z" as Instant;
const daysAgo = (days: number) =>
  new Date(Date.parse(now) - days * 86_400_000).toISOString() as Instant;

const record = (key: string, facets: Facets, updated = 1): IndexRecord => ({
  id: `jira:${key}`,
  stableId: `1${key.slice(4)}`,
  title: key,
  location: `https://example.invalid/browse/${key}`,
  updatedAt: daysAgo(updated),
  facets,
  attrs: {},
});
const epic = (key: string, state: Facets["state"] = "in-progress") =>
  record(key, { kind: "epic", state });
const story = (key: string, epicKey: string | null, state: Facets["state"], updated: number) =>
  record(
    key,
    {
      kind: "story",
      state,
      container:
        epicKey === null ? null : { id: `jira:${epicKey}`, stableId: `1${epicKey.slice(4)}` },
    },
    updated,
  );

const candidates = (records: IndexRecord[], held: string[] = []) =>
  jiraOverview({ records, changes: [], held: (r) => held.includes(r.id), now });

test("an epic no workstream holds is a cluster of the epic grouping, weighted by what changed this week", () => {
  const records = [
    epic("SYN-1"),
    story("SYN-2", "SYN-1", "todo", 2),
    story("SYN-3", "SYN-1", "done", 6),
    story("SYN-4", "SYN-1", "todo", 8),
    epic("SYN-5"),
  ];
  assert.deepEqual(candidates(records), [
    {
      subject: { kind: "cluster", grouping: "epic", key: "11" },
      rule: "An epic no workstream holds",
      weight: 3,
      detail: "2 changed this week",
    },
    {
      subject: { kind: "cluster", grouping: "epic", key: "15" },
      rule: "An epic no workstream holds",
      weight: 1,
    },
  ]);
});

test("an epic a workstream holds, or one that is done, is no candidate", () => {
  assert.deepEqual(candidates([epic("SYN-1"), epic("SYN-2", "done")], ["jira:SYN-1"]), []);
});

test("an item in progress with no update in 14 days has stalled; one updated since, or not in progress, hasn't", () => {
  const records = [
    story("SYN-10", null, "in-progress", 14),
    story("SYN-11", null, "in-progress", 13),
    story("SYN-12", null, "todo", 40),
    story("SYN-13", null, "in-progress", 30),
  ];
  assert.deepEqual(candidates(records, ["jira:SYN-13"]), [
    {
      subject: { kind: "item", id: "jira:SYN-10" },
      rule: "In progress, no update in 14 days",
      weight: 1.5,
      detail: "14 days idle",
    },
  ]);
});
