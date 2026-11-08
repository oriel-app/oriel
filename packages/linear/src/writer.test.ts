// Linear's writer through Linear's MCP server (OA-278): each mutation is
// one call of a write tool, from the process with only those, with what it
// checks first read through the read tools; what it can't take is refused
// before anything is sent; and a create, which no tool can delete, says so
// before a Revert is offered. The stand-in answers, in memory.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type ItemId,
  SourceRefused,
  type SourceWriter,
  type ToolCall,
  type ToolCaller,
  type Ulid,
  type WriteRequest,
  WriteStalled,
} from "@oriel/core";
import { linearServer, linearTools as t } from "./linear-mcp.ts";
import { linearStandIn, standInCaller, standInWorld } from "./linear-standin.ts";
import { linearSpecs } from "./specs.ts";
import { takeIssues } from "./take-issues.ts";
import { linearWriter } from "./writer.ts";
import { loadLinearWorld } from "./world.ts";

const team = { id: "00000001-0000-4000-8000-000000000001", key: "ENG", name: "Ferrowick" };
const stable = (n: number) => `00000007-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

function writing() {
  const tools = standInCaller(linearStandIn(standInWorld(loadLinearWorld())));
  const reads: ToolCall[] = [];
  const writes: ToolCall[] = [];
  const by =
    (into: ToolCall[], allowed: readonly string[]): ToolCaller =>
    async (call) => {
      if (!allowed.includes(call.tool)) throw new Error(`${call.tool} isn't allowed here`);
      into.push(call);
      return tools(call);
    };
  const writer = linearWriter({
    team,
    read: by(reads, linearServer.reads),
    write: by(writes, linearServer.writes),
  });
  let n = 0;
  const apply = (op: string, target: string | null, args: unknown, expected?: string) =>
    writer.apply({
      mutationId: `01JMUTATION${String((n += 1)).padStart(15, "0")}` as Ulid,
      op,
      target: target as ItemId<"linear"> | null,
      expectedStableId: target === null ? null : (expected ?? null),
      args,
    } as WriteRequest<"linear"> as Parameters<SourceWriter<"linear">["apply"]>[0]);
  return { writer, apply, reads, writes, tools };
}

test("each set op is one save of the field it sets, reporting it before and after", async () => {
  const { apply, writes } = writing();
  const cases: [string, unknown, Record<string, unknown>, string, unknown, unknown][] = [
    [
      "setTitle",
      { title: "Timetable by day" },
      { title: "Timetable by day" },
      "summary",
      "Timetable screen: sailings by day, with the evening service",
      "Timetable by day",
    ],
    ["setEstimate", { estimate: 5 }, { estimate: 5 }, "points", 8, 5],
    [
      "setAssignee",
      { name: "Dara Nikolaidis" },
      { assignee: "00000002-0000-4000-8000-000000000004" },
      "assignee",
      "Chen Yuting",
      "Dara Nikolaidis",
    ],
    [
      "setStatus",
      { status: "In Review" },
      { state: "00000003-0000-4000-8000-000000000005" },
      "status",
      "In Progress",
      "In Review",
    ],
    ["setCycle", { cycle: 14 }, { cycle: "00000005-0000-4000-8000-00000000000e" }, "cycle", 13, 14],
    [
      "addLabel",
      { label: "launch" },
      { labels: ["timetable", "mobile", "launch"] },
      "label:launch",
      false,
      true,
    ],
  ];
  for (const [op, args, sent, field, before, after] of cases) {
    const result = await apply(op, "linear:ENG-2", args, stable(2));
    const call = writes.at(-1);
    assert.deepEqual(call, { tool: t.saveIssue, args: { id: stable(2), ...sent } }, op);
    assert.equal(result.before[field], before, op);
    assert.equal(result.after[field], after, op);
    assert.equal(typeof result.after.updated, "string", op);
    // Its revert sets back what it was.
    const undo = linearSpecs.ops[op]?.undo(args, result);
    assert.ok(undo && !("refused" in undo), op);
  }
  assert.equal(writes.length, cases.length, "one write call each");
});

test("what Linear can't take is refused before anything is sent", async () => {
  const { apply, writes } = writing();
  const refusals: [string, string | null, unknown, string?][] = [
    ["setStatus", "linear:ENG-2", { status: "Shipped" }, stable(2)],
    ["setAssignee", "linear:ENG-2", { name: "Greta Lindqvist" }, stable(2)],
    ["setCycle", "linear:ENG-2", { cycle: 40 }, stable(2)],
    ["setEstimate", "linear:ENG-2", { estimate: 3 }, stable(3)],
    ["setEstimate", "linear:ENG-99", { estimate: 3 }, stable(99)],
    ["createIssue", null, { title: "X", project: "linear:P-000000000000" }],
    [
      "setEstimate",
      "linear:P-5e2a9c41b7d0",
      { estimate: 3 },
      "00000006-0000-4000-8000-000000000001",
    ],
  ];
  for (const [op, target, args, expected] of refusals)
    await assert.rejects(apply(op, target, args, expected), (error: unknown) => {
      assert.ok(error instanceof SourceRefused && !error.sent, `${op}: ${String(error)}`);
      return true;
    });
  assert.deepEqual(writes, [], "nothing went out");
});

test("no tool deletes an issue or a project, so the writer says so before Revert is offered", async () => {
  const { writer, apply, writes } = writing();
  assert.ok(writer.unsendable?.deleteItem);
  // Each create's revert is that delete.
  assert.deepEqual(linearSpecs.ops.createIssue?.undo({ title: "X", project: null }, {} as never), {
    op: "deleteItem",
    args: {},
  });
  await assert.rejects(apply("deleteItem", "linear:ENG-2", {}, stable(2)), SourceRefused);
  assert.deepEqual(writes, []);
});

test("the stand-in tracker's issues move into Linear as projects and the issues in them", async () => {
  const { mutations, items } = takeIssues([
    {
      id: "tracker:T-2",
      kind: "story",
      summary: "Pricing page",
      description: "Three tiers.",
      points: 3,
      epic: "tracker:T-1",
    },
    {
      id: "tracker:T-1",
      kind: "epic",
      summary: "Spring launch",
      description: "",
      points: null,
      epic: null,
    },
    {
      id: "tracker:T-3",
      kind: "story",
      summary: "Loose end",
      description: "",
      points: 2000,
      epic: null,
    },
  ] as never);
  assert.deepEqual(mutations, [
    {
      op: "createProject",
      target: null,
      ref: "new:1",
      args: { name: "Spring launch" },
      into: "linear",
    },
    {
      op: "createIssue",
      target: null,
      ref: "new:2",
      args: { title: "Pricing page", description: "Three tiers.", estimate: 3, project: "new:1" },
      into: "linear",
    },
    {
      op: "createIssue",
      target: null,
      ref: "new:3",
      args: { title: "Loose end", estimate: 64, project: null },
      into: "linear",
    },
  ]);
  assert.deepEqual(items, {
    "new:1": "tracker:T-1",
    "new:2": "tracker:T-2",
    "new:3": "tracker:T-3",
  });
  for (const m of mutations) assert.ok(linearSpecs.ops[m.op]?.args(m.args).ok, m.op);
});

test("a write the replay turned away unsent is refused as unsent, so it can be sent again", async () => {
  const tools = standInCaller(linearStandIn(standInWorld(loadLinearWorld())));
  const writer = linearWriter({
    team,
    read: tools,
    write: async () => {
      throw new WriteStalled("the replay denied the call");
    },
  });
  await assert.rejects(
    writer.apply({
      mutationId: "01JMUTATION000000000000001" as Ulid,
      op: "createProject",
      target: null,
      expectedStableId: null,
      args: { name: "Winter timetable" },
    } as WriteRequest<"linear"> as Parameters<SourceWriter<"linear">["apply"]>[0]),
    (error: unknown) => error instanceof SourceRefused && !error.sent,
  );
});

test("a status is matched by its exact name first, so one that differs only in case can't take its place", async () => {
  const world = standInWorld(loadLinearWorld());
  const eng = team.id;
  world.statuses.unshift({
    id: "00000003-0000-4000-8000-0000000000ff",
    team: eng,
    name: "done",
    type: "canceled",
  });
  const tools = standInCaller(linearStandIn(world));
  const writes: ToolCall[] = [];
  const writer = linearWriter({
    team,
    read: tools,
    write: async (call) => (writes.push(call), tools(call)),
  });
  await writer.apply({
    mutationId: "01JMUTATION000000000000002" as Ulid,
    op: "setStatus",
    target: "linear:ENG-2" as ItemId<"linear">,
    expectedStableId: stable(2),
    args: { status: "Done" },
  } as WriteRequest<"linear"> as Parameters<SourceWriter<"linear">["apply"]>[0]);
  assert.deepEqual(writes[0]?.args, {
    id: stable(2),
    state: "00000003-0000-4000-8000-000000000006",
  });
});
