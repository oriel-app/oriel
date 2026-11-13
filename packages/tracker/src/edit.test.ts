import assert from "node:assert/strict";
import { test } from "node:test";
import type { Instant } from "@oriel/core";
import { trackerEditor } from "./edit.ts";
import { issuesIn } from "./issues.ts";
import { memoryItems } from "./memory.ts";

const now = () => "2026-11-06T09:00:00.000Z" as Instant;

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
  const undone = await edit("tracker:T-2", done.before);
  assert.deepEqual(undone, { before: done.after, after: done.before });
  assert.equal(issues.byKey("T-2")?.summary, "Pricing");
  assert.equal(issues.byKey("T-2")?.points, null);
});

test("an edit takes only the fields the form has, values the ops take, and an issue the tracker has", async () => {
  const { own, edit } = await store();
  await assert.rejects(edit("tracker:T-2", { epic: "tracker:T-1" }));
  await assert.rejects(edit("tracker:T-2", { status: "Shipped" }));
  await assert.rejects(edit("tracker:T-2", { summary: " " }));
  await assert.rejects(edit("tracker:T-2", { labels: ["two words"] }));
  await assert.rejects(edit("tracker:T-1", { points: 2 }));
  await assert.rejects(edit("tracker:T-9", { summary: "x" }));
  await assert.rejects(edit("jira:SYN-2", { summary: "x" }));
  assert.deepEqual(own.written, []);
});
