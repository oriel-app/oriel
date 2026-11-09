// Each tracker's agent side, as text, is byte for byte what it was before
// core's issue shape built it (OA-327): its module, its writes, its ops'
// lines, its panel and what it takes in. The golden copies were taken on
// main at 333c03e8; a change to one is a change to what the agent reads.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadFixtures } from "./fixtures.ts";
import { capture, type Probes } from "./issue-shape.ts";

const text = ["A summary", "", " ", "x".repeat(300), 3, null, "two words", "Done", "In Progress"];
const creates = [
  { summary: "A story", title: "A story", name: "A project" },
  { summary: "A story", title: "A story", points: 3, estimate: 3, description: "Why" },
  { summary: "A story", title: "A story", epic: "new:1", project: "new:1" },
  { summary: "A story", title: "A story", epic: "new:2", project: "new:2" },
  { summary: "A story", title: "A story", cycle: 1, estimate: 2.5, points: -1 },
  { summary: "", title: "" },
  "not an object",
];
const values = {
  createEpic: creates,
  createProject: creates,
  createStory: creates,
  createIssue: creates,
  setSummary: text,
  setTitle: text,
  setDescription: text,
  setEstimate: [0, 2, 2.5, 64, 65, 1001, -1, null, "3"],
  setAssignee: text,
  setStatus: text,
  setCycle: [1, 2, 3, 4, 50, 0, null, "1"],
  addLabel: text,
};
const probes = (epic: string): Probes => ({
  values,
  taken: [
    {
      id: "tracker:T-1",
      kind: "epic",
      summary: "An epic",
      description: "",
      points: null,
      epic: null,
    },
    {
      id: "tracker:T-2",
      kind: "story",
      summary: `  ${"y".repeat(300)} `,
      description: "Some text",
      points: 2.6,
      epic: "tracker:T-1",
    },
    { id: "tracker:T-3", kind: "story", summary: "   ", description: "", points: 99, epic: null },
    {
      id: "tracker:T-4",
      kind: "story",
      summary: "Orphan",
      description: "",
      points: null,
      epic: "tracker:T-9",
    },
  ],
  args: {
    createEpic: [
      { summary: "An epic" },
      { summary: "An epic", description: "Why" },
      { summary: "" },
    ],
    createProject: [{ name: "A project" }, { name: "A project", description: "Why" }, { name: "" }],
    createStory: [
      { summary: "A story", epic: null },
      { summary: "A story", epic: "new:1", points: 1 },
      { summary: "A story", epic: epic, points: 3, description: "d" },
      { summary: "A story", epic: "tracker:T-404" },
    ],
    createIssue: [
      { title: "An issue", project: null },
      { title: "An issue", project: "new:1", estimate: 1, cycle: 2 },
      { title: "An issue", project: epic, estimate: 3, description: "d" },
      { title: "An issue", project: "linear:NOPE-1" },
    ],
    setSummary: [{ summary: "Renamed" }],
    setTitle: [{ title: "Renamed" }],
    setDescription: [{ description: "" }, { description: "New text" }],
    setEstimate: [
      { points: null },
      { points: 1 },
      { points: 4 },
      { estimate: null },
      { estimate: 1 },
      { estimate: 4 },
    ],
    setAssignee: [{ name: null }, { name: "Grace" }],
    setStatus: [{ status: "Todo" }, { status: "Done" }],
    setCycle: [{ cycle: null }, { cycle: 3 }, { cycle: 4 }],
    addLabel: [{ label: "urgent" }, { label: "later" }],
    removeLabel: [{ label: "urgent" }],
    deleteItem: [{}],
  },
});

const fixtures = loadFixtures();

for (const [kind, epic] of [
  ["tracker", "tracker:T-1"],
  ["linear", "linear:P-5e2a9c41b7d0"],
] as const)
  test(`the ${kind}'s agent side reads as it did before core's issue shape built it`, async () => {
    const fixture = fixtures.get(kind);
    assert.ok(fixture);
    const golden = readFileSync(new URL(`../golden/${kind}.txt`, import.meta.url), "utf8");
    assert.equal(await capture(kind, fixture, probes(epic)), golden);
  });
