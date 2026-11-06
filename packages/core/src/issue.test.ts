import assert from "node:assert/strict";
import { test } from "node:test";
import { issueFacets, issueFacts, issueFields, issueOverview } from "./issue.ts";
import type { Instant } from "./ids.ts";
import type { Facets, IndexRecord } from "./source.ts";

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
  issueOverview({ records, changes: [], held: (r) => held.includes(r.id), now });

test("an epic no workstream holds is a cluster of the epic grouping, weighted by what changed this week", () => {
  const records = [
    epic("SYN-1"),
    story("SYN-2", "SYN-1", "todo", 2),
    story("SYN-3", "SYN-1", "in-progress", 6),
    story("SYN-4", "SYN-1", "todo", 8),
    // Done, or held, it asks nothing more of the user.
    story("SYN-6", "SYN-1", "done", 1),
    story("SYN-7", "SYN-1", "todo", 1),
    epic("SYN-5"),
  ];
  assert.deepEqual(candidates(records, ["jira:SYN-7"]), [
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

test("a field a tracker doesn't have leaves its facet and its fact out; one it has and is empty doesn't", () => {
  const bare = { kind: "task", type: "Task", status: { name: "Open", category: "todo" as const } };
  const issue = { ...bare, updatedAt: now };
  assert.deepEqual(issueFacets(issue), { state: "todo", kind: "task" });
  assert.deepEqual(issueFacts(bare).facts, [
    { name: "Type", value: "Task" },
    { name: "Status", value: "Open" },
  ]);
  const empty = { ...issue, container: null, assignee: null, estimate: null, labels: [] };
  assert.deepEqual(issueFacets(empty), {
    people: [],
    state: "todo",
    container: null,
    kind: "task",
    estimate: null,
  });
  assert.deepEqual(issueFacts(empty).facts.slice(2), [
    { name: "Assignee", value: "Unassigned" },
    { name: "Estimate", value: "Not estimated yet" },
  ]);
  assert.ok(issueFields(empty).ok);
  assert.ok(!issueFields({ ...issue, status: { name: "Open", category: "open" } }).ok);
});
