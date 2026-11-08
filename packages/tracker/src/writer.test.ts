import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Instant,
  type ItemId,
  SourceRefused,
  type SourceWriter,
  ulid,
  type WriteRequest,
  type WriteResult,
} from "@oriel/core";
import { issuesIn } from "./issues.ts";
import { memoryItems } from "./memory.ts";
import { trackerSpecs } from "./specs.ts";
import { trackerWriter } from "./writer.ts";

// Stands in for packages/changeset, the only place that mints approvals in
// production. These tests cover the writes, not the approval gate.
// scripts/check-repo.ts allows this cast only in an adapter's writer test.
const approve = (request: WriteRequest<"tracker">) =>
  request as Parameters<SourceWriter<"tracker">["apply"]>[0];

// A store and its writer, on a clock a second on at each read.
function tracker() {
  const own = memoryItems();
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 10, 6, 9, 0, tick++)).toISOString() as Instant;
  const writer = trackerWriter({ own, now });
  let seq = 0;
  const send = (op: string, target: ItemId<"tracker"> | null, args: unknown, stableId?: string) =>
    writer.apply(
      approve({
        mutationId: ulid(0, new Uint8Array(10).fill(seq++)),
        op,
        target,
        expectedStableId: target === null ? null : (stableId ?? target.slice("tracker:T-".length)),
        args,
      }),
    );
  // What the spec says undoes an applied write, sent.
  const undo = (op: string, target: ItemId<"tracker">, args: unknown, applied: WriteResult) => {
    const back = trackerSpecs.ops[op]?.undo(args, applied);
    assert.ok(back && "op" in back, `${op} undoes`);
    return send(back.op, target, back.args);
  };
  return { own, issues: issuesIn(own), writer, send, undo };
}

test("a story goes only in an epic the tracker has", async () => {
  const { send } = tracker();
  await send("createStory", null, { summary: "Loose", epic: null });
  await assert.rejects(
    send("createStory", null, { summary: "In a story", epic: "tracker:T-1" }),
    (error) => error instanceof SourceRefused && !error.sent,
  );
  await assert.rejects(
    send("createStory", null, { summary: "Elsewhere", epic: "jira:SYN-1" }),
    SourceRefused,
  );
});

test("each set op reports what it changed, and its revert sets it back", async () => {
  const { issues, send, undo } = tracker();
  await send("createEpic", null, { summary: "Launch" });
  await send("createStory", null, { summary: "Pricing", epic: "tracker:T-1" });
  const story = "tracker:T-2" as const;
  const cases: [string, unknown, Record<string, unknown>, Record<string, unknown>][] = [
    [
      "setSummary",
      { summary: "Pricing page" },
      { summary: "Pricing" },
      { summary: "Pricing page" },
    ],
    [
      "setDescription",
      { description: "Three tiers" },
      { description: "" },
      { description: "Three tiers" },
    ],
    ["setEstimate", { points: 5 }, { points: null }, { points: 5 }],
    ["setAssignee", { name: "Ada Quill" }, { assignee: null }, { assignee: "Ada Quill" }],
    ["setStatus", { status: "In progress" }, { status: "To do" }, { status: "In progress" }],
    ["addLabel", { label: "web" }, { "label:web": false }, { "label:web": true }],
  ];
  for (const [op, args, before, after] of cases) {
    const was = issues.byKey("T-2");
    const applied = await send(op, story, args);
    assert.deepEqual(applied.before, before, op);
    const { updated, ...rest } = applied.after;
    assert.deepEqual(rest, after, op);
    assert.equal(updated, issues.byKey("T-2")?.updatedAt, op);
    await undo(op, story, args, applied);
    const back = issues.byKey("T-2");
    assert.deepEqual({ ...back, updatedAt: null }, { ...was, updatedAt: null }, op);
  }
});

test("a label it had already stays when adding it again is reverted", async () => {
  const { issues, send, undo } = tracker();
  await send("createStory", null, { summary: "Pricing", epic: null });
  await send("addLabel", "tracker:T-1", { label: "web" });
  const again = await send("addLabel", "tracker:T-1", { label: "web" });
  await undo("addLabel", "tracker:T-1", { label: "web" }, again);
  assert.deepEqual(issues.byKey("T-1")?.labels, ["web"]);
});

test("reverting a create deletes the issue, and its key is never given again", async () => {
  const { own, issues, send, undo } = tracker();
  const made = await send("createEpic", null, { summary: "Launch" });
  const deleted = await undo("createEpic", "tracker:T-1", { summary: "Launch" }, made);
  assert.deepEqual(deleted.after, {});
  assert.equal(deleted.before.summary, "Launch");
  assert.equal(issues.byKey("T-1"), null);
  assert.deepEqual(own.records(), []);
  const next = await send("createEpic", null, { summary: "Launch again" });
  assert.equal(next.item.id, "tracker:T-2");
  assert.ok("refused" in (trackerSpecs.ops.deleteItem?.undo({}, deleted) ?? {}));
});

test("a write to an issue that isn't there, or is another now, is refused, sending nothing", async () => {
  const { send, writer } = tracker();
  const refused = (error: unknown) => error instanceof SourceRefused && !error.sent;
  await assert.rejects(send("setSummary", "tracker:T-9", { summary: "x" }), refused);
  await send("createStory", null, { summary: "Pricing", epic: null });
  await assert.rejects(send("setSummary", "tracker:T-1", { summary: "x" }, "7"), refused);
  await assert.rejects(send("setStatus", "tracker:T-1", { status: "Shipped" }), refused);
  await assert.rejects(send("deleteItem", null, {}), refused);
  assert.equal(await writer.current("tracker:T-9", ["summary"]), "gone");
  assert.deepEqual(await writer.read("tracker:T-1", ["summary", "label:web"]), {
    stableId: "1",
    values: { summary: "Pricing", "label:web": false },
  });
});

test("a write that fails in the store changed nothing, and is refused as unsent", async () => {
  const own = memoryItems();
  const failing = { ...own, write: async () => Promise.reject(new Error("disk full")) };
  const writer = trackerWriter({ own: failing, now: () => "2026-11-06T09:00:00.000Z" as Instant });
  await assert.rejects(
    writer.apply(
      approve({
        mutationId: ulid(0, new Uint8Array(10)),
        op: "createEpic",
        target: null,
        expectedStableId: null,
        args: { summary: "Launch" },
      }),
    ),
    (error) => error instanceof SourceRefused && !error.sent,
  );
});

test("creates applied at once each take their own key, as writes take turns", async () => {
  const { own, send } = tracker();
  const made = await Promise.all([
    send("createEpic", null, { summary: "One" }),
    send("createEpic", null, { summary: "Two" }),
  ]);
  assert.deepEqual(
    made.map((each) => each.item.id),
    ["tracker:T-1", "tracker:T-2"],
  );
  assert.equal(own.records().length, 2);
});

test("an epic that holds a story stays when its create is reverted", async () => {
  const { issues, send, undo } = tracker();
  const epic = await send("createEpic", null, { summary: "Launch" });
  await send("createStory", null, { summary: "Pricing", epic: "tracker:T-1" });
  await assert.rejects(
    undo("createEpic", "tracker:T-1", { summary: "Launch" }, epic),
    SourceRefused,
  );
  assert.ok(issues.byKey("T-1"));
});
