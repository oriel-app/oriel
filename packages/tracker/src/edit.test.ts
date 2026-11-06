import assert from "node:assert/strict";
import { test } from "node:test";
import type { Instant } from "@oriel/core";
import { trackerEditor } from "./edit.ts";
import { issuesIn } from "./issues.ts";
import { memoryItems } from "./memory.ts";
import { trackerNamespace } from "./namespace.ts";
import { trackerPanel } from "./panel.ts";
import { trackerSource } from "./source.ts";

const now = () => "2026-11-06T09:00:00.000Z" as Instant;

// A store holding an epic and a story in it.
async function store() {
  const own = memoryItems();
  const issues = issuesIn(own);
  const base = {
    description: "",
    status: "To do" as const,
    assignee: null,
    labels: [],
    updatedAt: now(),
  };
  await issues.put({ by: "change-set", change: "created", fields: [] }, [
    { ...base, key: "T-1", kind: "epic", summary: "Launch", epic: null, points: null },
    {
      ...base,
      key: "T-2",
      kind: "story",
      summary: "Pricing",
      epic: { id: "tracker:T-1", stableId: "1" },
      points: null,
    } as const,
  ]);
  own.written.length = 0;
  return {
    own,
    issues,
    edit: trackerEditor({ own, now: () => "2026-11-06T10:00:00.000Z" as Instant }),
  };
}

test("a person's edit applies at once, and setting back what it replaced undoes it", async () => {
  const { own, issues, edit } = await store();
  const done = await edit("tracker:T-2", {
    summary: "Pricing page",
    status: "In progress",
    points: 3,
    assignee: "Ada Quill",
    labels: ["web", "launch"],
    description: "Three tiers.",
  });
  assert.deepEqual(done, {
    before: {
      summary: "Pricing",
      description: "",
      status: "To do",
      points: null,
      assignee: null,
      labels: [],
    },
    after: {
      summary: "Pricing page",
      description: "Three tiers.",
      status: "In progress",
      points: 3,
      assignee: "Ada Quill",
      labels: ["web", "launch"],
    },
  });
  const record = own.records().find((each) => each.id === "tracker:T-2");
  assert.equal(record?.title, "Pricing page");
  assert.equal(record?.facets.state, "in-progress");
  assert.equal(record?.updatedAt, "2026-11-06T10:00:00.000Z");
  assert.deepEqual(own.written, [
    {
      by: "person",
      change: "edited",
      fields: ["summary", "description", "status", "points", "assignee", "labels"],
    },
  ]);
  // Its Undo.
  const undone = await edit("tracker:T-2", done.before);
  assert.deepEqual(undone, { before: done.after, after: done.before });
  assert.equal(issues.byKey("T-2")?.summary, "Pricing");
  assert.equal(issues.byKey("T-2")?.points, null);
});

test("an edit that changes nothing writes nothing", async () => {
  const { own, edit } = await store();
  assert.deepEqual(await edit("tracker:T-2", { summary: "Pricing" }), { before: {}, after: {} });
  assert.deepEqual(own.written, []);
});

test("an edit takes only the fields the form has, values the ops take, and an issue the tracker has", async () => {
  const { own, edit } = await store();
  await assert.rejects(edit("tracker:T-2", { epic: "tracker:T-1" }), /no epic to edit/);
  await assert.rejects(edit("tracker:T-2", { status: "Shipped" }), /expected one of/);
  await assert.rejects(edit("tracker:T-2", { summary: " " }), RangeError);
  await assert.rejects(edit("tracker:T-2", { labels: ["two words"] }), /no spaces/);
  await assert.rejects(edit("tracker:T-1", { points: 2 }), /takes no estimate/);
  await assert.rejects(edit("tracker:T-9", { summary: "x" }), /isn't in the tracker/);
  await assert.rejects(edit("jira:SYN-2", { summary: "x" }), /isn't in the tracker/);
  assert.deepEqual(own.written, []);
});

test("its panel shows an issue's facts and description, with the form it is edited in", async () => {
  const { own } = await store();
  const [read] = await trackerSource(own).read(["tracker:T-2"]);
  assert.ok(read?.status === "ok");
  const view = trackerPanel(read.content);
  assert.deepEqual(view?.blocks, [
    {
      kind: "facts",
      facts: [
        { name: "Type", value: "Story" },
        { name: "Status", value: "To do" },
        { name: "Assignee", value: "Unassigned" },
        { name: "Estimate", value: "Not estimated yet" },
      ],
    },
    { kind: "text", heading: "Description", text: "No description.", format: "plain" },
  ]);
  assert.deepEqual(
    view?.edit?.fields.map((field) => [field.name, field.kind, field.value]),
    [
      ["summary", "line", "Pricing"],
      ["status", "choice", "To do"],
      ["assignee", "person", null],
      ["points", "number", null],
      ["labels", "list", []],
      ["description", "text", ""],
    ],
  );
  // An epic's form has no estimate.
  const [epic] = await trackerSource(own).read(["tracker:T-1"]);
  assert.ok(epic?.status === "ok");
  assert.ok(!trackerPanel(epic.content)?.edit?.fields.some((field) => field.name === "points"));
});

test("the namespace offers nothing while the tracker is off, and creates in a blank region while it's on", () => {
  const blank = { ids: [], anchor: null };
  const off = trackerNamespace(new Map(), false);
  assert.deepEqual([off.blank, off.fns(blank), off.types(blank)], [undefined, [], []]);
  const on = trackerNamespace(new Map(), true);
  assert.equal(on.blank, true);
  assert.deepEqual(
    on.fns(blank).map((fn) => fn.name),
    ["createEpic", "createStory"],
  );
  const held = trackerNamespace(new Map([["tracker:T-1", "epic"]]), true);
  assert.deepEqual(
    held.fns({ ids: ["tracker:T-1", "tracker:T-2"], anchor: null }).map((fn) => fn.name),
    [
      "getItem",
      "listItems",
      "createStory",
      "setSummary",
      "setDescription",
      "setEstimate",
      "setAssignee",
      "setStatus",
      "addLabel",
    ],
  );
});
