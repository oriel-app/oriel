import assert from "node:assert/strict";
import { test } from "node:test";
import { applyChanges, fixtureSnapshot, parseJiraFixture } from "./fixture.ts";

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
  changes: [
    { kind: "setEpic", key: "SYN-3", epic: "SYN-2", at: "2026-10-01T10:00:00.000Z" },
    { kind: "setSummary", key: "SYN-3", summary: "Renamed", at: "2026-10-01T11:00:00.000Z" },
    { kind: "delete", key: "SYN-5", at: "2026-10-01T12:00:00.000Z" },
  ],
  regions: [{ name: "first-epic", items: ["jira:SYN-1", "jira:SYN-3", "jira:SYN-5"] }],
});

const parsed = () => {
  const result = parseJiraFixture(input());
  assert.ok(result.ok, JSON.stringify(!result.ok && result.issues));
  return result.value;
};

test("a consistent fixture parses", () => {
  assert.equal(parsed().issues.length, 4);
});

test("broken references are reported with their paths", () => {
  const broken = input();
  broken.issues[2] = issue("SYN-3", { epic: "SYN-5", assignee: "nobody" });
  broken.changes[2] = { kind: "delete", key: "SYN-9", at: "2026-10-01T12:00:00.000Z" };
  broken.regions[0] = { name: "first-epic", items: ["jira:SYN-4"] };
  const result = parseJiraFixture(broken);
  assert.equal(result.ok, false);
  assert.deepEqual(!result.ok && result.issues.map((i) => i.path), [
    "$.issues[2].epic",
    "$.issues[2].assignee",
    "$.changes[2].key",
    "$.regions[0].items[0]",
  ]);
});

test("keys ascend, epics come first, and changes follow the base in order", () => {
  const broken = input();
  broken.issues.reverse();
  broken.changes[0] = {
    kind: "setEpic",
    key: "SYN-3",
    epic: "SYN-2",
    at: "2026-08-01T10:00:00.000Z",
  };
  const result = parseJiraFixture(broken);
  assert.equal(result.ok, false);
  const paths = !result.ok ? result.issues.map((i) => i.path) : [];
  assert.ok(paths.includes("$.issues[1].key"));
  assert.ok(paths.includes("$.issues[0].epic"));
  assert.ok(paths.includes("$.changes[0].at"));
});

test("changes apply in order and report what they deleted", () => {
  const fixture = parsed();
  assert.equal(applyChanges(fixture, 0).issues.length, 4);
  const { issues, gone } = applyChanges(fixture, fixture.changes.length);
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
    url: "https://oriel.atlassian.net/browse/SYN-3",
    updatedAt: "2026-09-01T10:00:00.000Z",
    attrs: {
      issueType: "Story",
      status: { name: "To Do", category: "todo" },
      epic: "jira:SYN-1",
      assignee: { accountId: "old", name: "Old Hand" },
      points: 3,
      labels: [],
    },
  });
  assert.deepEqual(before.content.get("jira:SYN-3")?.comments, [
    { author: "Ana Field", body: "Looks right.", at: "2026-08-30T10:00:00.000Z" },
  ]);

  const after = fixtureSnapshot(fixture, "https://oriel.atlassian.net", fixture.changes.length);
  const moved = after.records.find((record) => record.id === "jira:SYN-3");
  assert.equal(moved?.attrs.epic, "jira:SYN-2");
  assert.equal(moved?.title, "Renamed");
  assert.equal(moved?.updatedAt, "2026-10-01T11:00:00.000Z");
  assert.equal(after.content.has("jira:SYN-5"), false);
  assert.deepEqual(after.gone, ["10005"]);
});
