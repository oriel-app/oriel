import assert from "node:assert/strict";
import { test } from "node:test";
import { applySourceEdits, fixtureSnapshot, parseJiraFixture } from "./fixture.ts";
import type { Region } from "@oriel/core";

const issue = (key: string, fields: Record<string, unknown> = {}) => ({
  key,
  id: String(10000 + Number(key.slice(4))),
  issueType: "Story",
  summary: `Summary of ${key}`,
  description: "",
  status: { name: "To Do", category: "todo" },
  epic: null,
  assignee: null,
  points: null,
  labels: [],
  comments: [],
  links: [],
  updatedAt: "2026-09-01T10:00:00.000Z",
  ...fields,
});

const input = () => ({
  project: { key: "SYN", product: "Testwick" },
  people: [
    { id: "ana", displayName: "Ana Field", active: true },
    { id: "old", displayName: "Old Hand", active: false },
  ],
  issues: [
    issue("SYN-1", { issueType: "Epic", summary: "First epic" }),
    issue("SYN-2", { issueType: "Epic", summary: "Second epic" }),
    issue("SYN-3", {
      epic: "SYN-1",
      assignee: "old",
      points: 3,
      comments: [{ author: "ana", body: "Looks right.", at: "2026-08-30T10:00:00.000Z" }],
    }),
    issue("SYN-5", { epic: "SYN-1" }),
  ],
  edits: [
    { kind: "setEpic", key: "SYN-3", epic: "SYN-2", at: "2026-10-01T10:00:00.000Z" },
    { kind: "setSummary", key: "SYN-3", summary: "Renamed", at: "2026-10-01T11:00:00.000Z" },
    { kind: "delete", key: "SYN-5", at: "2026-10-01T12:00:00.000Z" },
  ],
  regions: [
    {
      name: "first-epic",
      origin: { kind: "cluster", grouping: "epic", cluster: "10001", anchor: "jira:SYN-1" },
      items: ["jira:SYN-1", "jira:SYN-3", "jira:SYN-5"],
    },
    { name: "picked", origin: { kind: "picked" }, items: ["jira:SYN-5"] },
  ],
});

const parsed = () => {
  const result = parseJiraFixture(input());
  assert.ok(result.ok, JSON.stringify(!result.ok && result.issues));
  return result.value;
};

const paths = (value: unknown) => {
  const result = parseJiraFixture(value);
  return result.ok ? [] : result.issues.map((i) => i.path);
};

test("a consistent fixture parses, and its region origins are core's", () => {
  const fixture = parsed();
  assert.equal(fixture.issues.length, 4);
  const origins: Region["origin"][] = fixture.regions.map((region) => region.origin);
  assert.deepEqual(origins[1], { kind: "picked" });
  // The files name the anchor by its item ID; core adds its stable ID.
  assert.deepEqual(origins[0], {
    kind: "cluster",
    grouping: "epic",
    cluster: "10001",
    anchor: { id: "jira:SYN-1", stableId: "10001" },
  });
});

test("broken references are reported with their paths", () => {
  const broken = input();
  broken.issues[2] = issue("SYN-3", { epic: "SYN-5", assignee: "nobody" });
  broken.edits[2] = { kind: "delete", key: "SYN-9", at: "2026-10-01T12:00:00.000Z" };
  broken.regions[1] = { name: "picked", origin: { kind: "picked" }, items: ["jira:SYN-4"] };
  assert.deepEqual(paths(broken), [
    "$.issues[2].epic",
    "$.issues[2].assignee",
    "$.edits[2].key",
    // SYN-3 no longer sits under SYN-1, so the epic region doesn't match it.
    "$.regions[0].items",
    "$.regions[1].items[0]",
  ]);
});

test("keys ascend, epics come first, and edits follow the base in order", () => {
  const broken = input();
  broken.issues.reverse();
  broken.edits[0] = {
    kind: "setEpic",
    key: "SYN-3",
    epic: "SYN-2",
    at: "2026-08-01T10:00:00.000Z",
  };
  const found = paths(broken);
  assert.ok(found.includes("$.issues[1].key"));
  assert.ok(found.includes("$.issues[0].epic"));
  assert.ok(found.includes("$.edits[0].at"));
});

test("an edited summary keeps to Jira's 1 to 255 characters", () => {
  for (const summary of [" ", "x".repeat(256)]) {
    const broken = input();
    broken.edits[1] = { kind: "setSummary", key: "SYN-3", summary, at: "2026-10-01T11:00:00.000Z" };
    assert.deepEqual(paths(broken), ["$.edits[1].summary"]);
  }
});

test("an epic region holds exactly its epic and that epic's children", () => {
  const region = (cluster: string, items: string[]) => ({
    name: "first-epic",
    origin: { kind: "cluster", grouping: "epic", cluster, anchor: "jira:SYN-1" },
    items,
  });
  const missing = input();
  missing.regions[0] = region("10001", ["jira:SYN-1", "jira:SYN-3"]);
  assert.deepEqual(paths(missing), ["$.regions[0].items"]);
  const wrong = input();
  wrong.regions[0] = region("SYN-1", ["jira:SYN-1", "jira:SYN-3", "jira:SYN-5"]);
  assert.deepEqual(paths(wrong), ["$.regions[0].origin.cluster"]);
  // Same size, wrong member: only the membership check catches it.
  const swapped = input();
  swapped.regions[0] = region("10001", ["jira:SYN-1", "jira:SYN-3", "jira:SYN-2"]);
  assert.deepEqual(paths(swapped), ["$.regions[0].items"]);
  const notEpic = input();
  notEpic.regions[0] = {
    name: "first-epic",
    origin: { kind: "cluster", grouping: "epic", cluster: "10003", anchor: "jira:SYN-3" },
    items: ["jira:SYN-3"],
  };
  assert.deepEqual(paths(notEpic), ["$.regions[0].origin.anchor"]);
});

test("source edits apply in order and report what they deleted", () => {
  const fixture = parsed();
  assert.equal(applySourceEdits(fixture, 0).issues.length, 4);
  const { issues, gone } = applySourceEdits(fixture, fixture.edits.length);
  assert.deepEqual(
    issues.map((i) => [i.key, i.epic, i.summary]),
    [
      ["SYN-1", null, "First epic"],
      ["SYN-2", null, "Second epic"],
      ["SYN-3", "SYN-2", "Renamed"],
    ],
  );
  assert.deepEqual(gone, ["10005"]);
});

test("the snapshot maps issues to index records and content", () => {
  const fixture = parsed();
  const before = fixtureSnapshot(fixture, "https://oriel.atlassian.net", 0);
  const story = before.records.find((record) => record.id === "jira:SYN-3");
  assert.deepEqual(story, {
    id: "jira:SYN-3",
    stableId: "10003",
    title: "Summary of SYN-3",
    location: "https://oriel.atlassian.net/browse/SYN-3",
    updatedAt: "2026-09-01T10:00:00.000Z",
    facets: {
      people: [{ role: "assignee", id: "old", name: "Old Hand" }],
      state: "todo",
      container: { id: "jira:SYN-1", stableId: "10001" },
      kind: "story",
      estimate: 3,
    },
    attrs: { issueType: "Story", status: "To Do", labels: [] },
  });
  const content = before.content.get("jira:SYN-3");
  assert.deepEqual(content?.comments, [
    { author: "Ana Field", body: "Looks right.", at: "2026-08-30T10:00:00.000Z" },
  ]);
  assert.deepEqual(
    [content?.status, content?.epic, content?.assignee],
    [{ name: "To Do", category: "todo" }, "jira:SYN-1", { accountId: "old", name: "Old Hand" }],
  );
  assert.equal(
    content?.text,
    "Summary of SYN-3\n\nAna Field, 2026-08-30T10:00:00.000Z:\nLooks right.",
  );

  const after = fixtureSnapshot(fixture, "https://oriel.atlassian.net", fixture.edits.length);
  const moved = after.records.find((record) => record.id === "jira:SYN-3");
  assert.deepEqual(moved?.facets.container, { id: "jira:SYN-2", stableId: "10002" });
  assert.equal(moved?.title, "Renamed");
  assert.equal(moved?.updatedAt, "2026-10-01T11:00:00.000Z");
  assert.equal(after.content.has("jira:SYN-5"), false);
  assert.deepEqual(after.gone, ["10005"]);
});
