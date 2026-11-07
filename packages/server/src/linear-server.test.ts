// Linear through Linear's MCP server (decision 0059, OA-278), end to end
// through the routes: the person's agent is a fake that lists the server,
// and its processes call the stand-in's tools on Ferrowick's Linear in
// memory. Sync reads with the read tools only, a change set's replay writes
// with the write tools only, from another process; a create offers no
// Revert, as no tool deletes one; an answer Oriel can't read keeps the
// index as it was; and with Linear off, nothing of it shows.
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import type { FoundServer, ToolCall } from "@oriel/core";
import { linearServer, linearTools } from "@oriel/linear";
import { linearStandIn, standInCaller } from "@oriel/linear/standin";
import type { DiffView, OverviewView, ThreadView, WorkstreamsView } from "@oriel/web/view";
import { fakeAgent } from "./servers/testing.ts";
import { json, type Script, testApp } from "./testing.ts";

const { reads, writes } = linearServer;

const linear = (over: Partial<FoundServer> = {}): FoundServer => ({
  name: "linear-server",
  status: "connected",
  reports: null,
  url: "https://mcp.linear.app/mcp",
  command: null,
  tools: [...reads, ...writes, "list_comments", "save_comment", "delete_comment"],
  transport: "http",
  ...over,
});

type Made = { process: number; tools: readonly string[]; call: ToolCall };

async function world(
  t: TestContext,
  options: {
    found?: () => FoundServer[];
    script?: Script;
    answer?: (call: ToolCall, answer: unknown) => unknown;
  } = {},
) {
  const tools = standInCaller(linearStandIn());
  const made: Made[] = [];
  let processes = 0;
  const agent = fakeAgent(options.found ?? (() => [linear()]));
  const it = await testApp(t, {
    connect: {},
    discover: agent.discover,
    plan: (input) => (input.text.startsWith("Draft") ? [{ run: "plan" }] : [{ run: "script" }]),
    scripts: {
      script: options.script ?? (async () => ({ value: null })),
      plan: async () => ({
        value: null,
        writes: [
          ["tracker.createEpic", [{ summary: "Spring launch" }], "new:1"],
          ["tracker.createStory", [{ summary: "Pricing page", points: 3, epic: "new:1" }], "new:2"],
        ],
      }),
    },
    callServer: async (_server, allowed) => {
      const process = ++processes;
      return {
        agent: { id: "codex", name: "Codex", kind: "codex" },
        calls: {
          call: async (call) => {
            if (!allowed.includes(call.tool)) throw new Error(`${call.tool} isn't allowed`);
            made.push({ process, tools: allowed, call });
            const answer = await tools(call);
            return (options.answer?.(call, answer) ?? answer) as never;
          },
          spent: () => ({
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            costUsd: 0,
            turns: 0,
          }),
          close: () => {},
        },
      };
    },
  });
  await it.app.settled();
  const turnOn = async () => {
    await it.post("/api/servers/look");
    const on = await it.post("/api/actions/source.on", { kind: "linear", server: "linear-server" });
    assert.equal(on.status, 200);
    await it.app.settled();
  };
  const rows = (grouping: "epic" | "assignee" | "stuck" = "epic") =>
    it.app
      .window(grouping)
      .clusters.flatMap((c) => c.list)
      .filter((row) => row.id.startsWith("linear:"));
  const approve = async (id: string) => {
    const diff = json<DiffView>(await it.post(`/api/change-sets/${id}/diff`));
    it.advance(1000);
    const reply = await it.post(`/api/change-sets/${id}/approve`, { hash: diff.hash });
    await it.app.settled();
    return { status: reply.status, diff };
  };
  return { ...it, made, turnOn, rows, approve };
}

test("Linear on through its server syncs its team with its read tools only, and Browse groups it with no code of its own", async (t) => {
  const it = await world(t);
  assert.equal(await it.connection("linear"), null, "nothing of Linear before it's on");
  await it.turnOn();
  const connection = await it.connection("linear");
  assert.equal(connection?.about, "ENG (Ferrowick), through Linear's MCP server");
  assert.equal(connection?.items, 24);
  assert.ok(
    it.made.every((each) => reads.includes(each.call.tool)),
    "sync never writes",
  );
  // Browse's groupings read the issue shape: the launch project is an epic
  // cluster, ENG-13 has stalled, and people are its assignees.
  const epic = it.app
    .window("epic")
    .clusters.find((c) => c.row.label === "Summer timetable launch");
  assert.ok(epic && epic.list.length >= 13);
  assert.ok(it.rows("stuck").some((row) => row.id === "linear:ENG-13"));
  assert.ok(it.rows("assignee").some((row) => row.id === "linear:ENG-2"));
  // The overview's candidates: a project no workstream holds.
  const overview = json<OverviewView>(await it.get("/api/overview"));
  assert.ok(JSON.stringify(overview).includes("Summer timetable launch"));
  const synced = it.app.telemetry().filter((event) => event.name === "source.server-synced");
  assert.equal(synced.length, 1);
  const data = synced[0]?.data as Record<string, unknown>;
  assert.equal(data.source, "linear", "its kind, never a team's or an issue's name");
  assert.deepEqual(Object.keys(data).toSorted(), ["agent", "items", "ms", "ok", "source"]);
});

test("an approved change replays through the write tools, from another process, and Revert sets it back", async (t) => {
  const plan: Script = async () => ({
    value: null,
    writes: [["linear.setCycle", ["linear:ENG-4", 14]]],
  });
  const it = await world(t, { script: plan });
  await it.turnOn();
  const { id: workstreamId } = json<{ id: string }>(
    await it.post("/api/workstreams", { kind: "picked", name: "Alerts", items: ["linear:ENG-4"] }),
  );
  const { id: threadId } = json<{ id: string }>(
    await it.post(`/api/workstreams/${workstreamId}/threads`, {
      text: "Plan ENG-4 for next cycle",
    }),
  );
  await it.app.settled();
  const view = json<ThreadView>(await it.get(`/api/threads/${threadId}`));
  const entry = view.entries.find((each) => each.kind === "change-set");
  assert.ok(entry?.kind === "change-set");
  const { status, diff } = await it.approve(entry.changeSetId);
  assert.equal(status, 200);
  assert.deepEqual(
    diff.lines.map((line) => [line.source, line.sentence]),
    [
      [
        "Linear",
        "Move “Alert passengers whose booked sailing moves” (ENG-4) from cycle 13 to cycle 14.",
      ],
    ],
  );
  const written = it.made.filter((each) => writes.includes(each.call.tool));
  assert.deepEqual(
    written.map((each) => each.call),
    [
      {
        tool: linearTools.saveIssue,
        args: {
          id: "00000007-0000-4000-8000-000000000004",
          cycle: "00000005-0000-4000-8000-00000000000e",
        },
      },
    ],
  );
  const writer = written[0];
  assert.ok(writer);
  assert.deepEqual(writer.tools, writes, "the writing process has only the write tools");
  assert.ok(
    it.made.every((each) => each.process !== writer.process || writes.includes(each.call.tool)),
    "sync and replay never share a process",
  );
  // A set op's revert is the same save with what it was: it's offered.
  const after = json<ThreadView>(await it.get(`/api/threads/${threadId}`));
  const set = after.changeSets.find((each) => each.id === entry.changeSetId);
  assert.deepEqual(
    set?.nextSteps.map((step) => step.kind),
    ["revert"],
  );
  assert.equal(set?.cannotUndo, undefined);
});

test("an answer Oriel can't read stops the sync with the server named, and keeps the index", async (t) => {
  let garble = false;
  const it = await world(t, {
    answer: (call, answer) =>
      garble && call.tool === linearTools.issues
        ? { content: [{ type: "text", text: "Here are your issues." }] }
        : answer,
  });
  await it.turnOn();
  const before = it.rows().length;
  garble = true;
  const synced = await it.sync("linear");
  const problem =
    "Linear's MCP server answered in a way Oriel didn't expect, so Oriel kept the window as it was.";
  assert.equal(synced.status, 502);
  assert.deepEqual(json(synced), { error: problem });
  assert.equal((await it.connection("linear"))?.problem, problem);
  assert.equal(it.rows().length, before);
});

test("turned on, Linear is offered the stand-in's issues; approved, they're projects and issues, with no Revert, and the move's empty workstream is done", async (t) => {
  const it = await world(t);
  await it.post("/api/window-chat/messages", { text: "Draft a launch" });
  await it.app.settled();
  const chat = json<{ thread: string }>(await it.get("/api/window-chat")).thread;
  const drafted = json<ThreadView>(await it.get(`/api/threads/${chat}`));
  const first = drafted.entries.find((each) => each.kind === "change-set");
  assert.ok(first?.kind === "change-set");
  assert.equal((await it.approve(first.changeSetId)).status, 200);
  await it.turnOn();
  const kinds = async () => (await it.connections()).connections.map((each) => each.kind);
  assert.deepEqual(await kinds(), ["linear", "tracker"], "both stay while the offer waits");
  const threads = json<{ threads: { id: string; title: string }[] }>(await it.get("/api/threads"));
  const into = threads.threads.find((each) => each.title === "Into Linear");
  assert.ok(into, "the move into Jira's, reused");
  const offer = json<ThreadView>(await it.get(`/api/threads/${into.id}`)).entries.find(
    (each) => each.kind === "change-set",
  );
  assert.ok(offer?.kind === "change-set");
  const { status, diff } = await it.approve(offer.changeSetId);
  assert.equal(status, 200);
  assert.deepEqual(
    diff.lines.map((line) => line.sentence),
    [
      "Create a project “Spring launch” in Linear.",
      "Create an issue “Pricing page” in the new project “Spring launch”, estimated at 3 points.",
    ],
  );
  const made = it.made.filter((each) => writes.includes(each.call.tool));
  assert.deepEqual(
    made.map((each) => each.call.tool),
    [linearTools.saveProject, linearTools.saveIssue],
  );
  assert.deepEqual(await kinds(), ["linear"], "the stand-in steps aside");
  // Its workstream holds the new items in place of the stand-in's.
  const pricing = it.rows().find((row) => row.title === "Pricing page");
  assert.ok(pricing?.id.startsWith("linear:ENG-"));
  // No tool deletes a project or an issue: no Revert, and it says why.
  const moved = json<ThreadView>(await it.get(`/api/threads/${into.id}`));
  const set = moved.changeSets.find((each) => each.id === offer.changeSetId);
  assert.deepEqual(set?.nextSteps, []);
  assert.equal(set?.cannotUndo, "A Linear issue or project can't be taken back");
  // The move's own workstream ends, and its rail says where its items went.
  assert.equal(moved.state, "done");
  assert.equal(moved.move?.went?.length, 1);
  const streams = json<WorkstreamsView>(await it.get("/api/workstreams")).workstreams;
  assert.notEqual(streams.find((each) => each.name === "Into Linear")?.done, null);
});

test("Linear off: nothing of it shows, and its server calls stop", async (t) => {
  const it = await world(t);
  await it.turnOn();
  assert.ok(it.rows().length > 0);
  const off = await it.post("/api/actions/source.off", { kind: "linear" });
  assert.equal(off.status, 200);
  await it.app.settled();
  assert.equal(it.rows().length, 0, "Browse shows none of its items");
  assert.equal(it.rows("stuck").length, 0);
  const overview = json<OverviewView>(await it.get("/api/overview"));
  assert.ok(!JSON.stringify(overview).includes("Summer timetable launch"));
  const calls = it.made.length;
  await it.sync("linear");
  await it.app.settled();
  assert.equal(it.made.length, calls);
});

test("Linear's team is picked through its server, and the pick bounds the next sync", async (t) => {
  const it = await world(t);
  await it.turnOn();
  const before = await it.connection("linear");
  assert.deepEqual(before?.options, {}, "nothing picked: the server's first team");
  assert.deepEqual(
    before?.picks.map((pick) => [pick.name, pick.unpicked]),
    [["team", "the first team it lists"]],
  );
  assert.ok(it.rows().some((row) => row.id.startsWith("linear:ENG-")));
  const id = before?.id ?? "";
  const listed = json<{ choices: { value: string; name: string }[] }>(
    await it.post(`/api/connections/${id}/pick`, { query: "", field: "team" }),
  );
  assert.deepEqual(
    listed.choices.map((each) => [each.value, each.name]),
    [
      ["ENG", "Ferrowick"],
      ["OPS", "Pier operations"],
    ],
  );
  it.made.length = 0;
  const set = await it.post(`/api/connections/${id}/options`, { options: { team: "OPS" } });
  assert.equal(set.status, 200);
  await it.app.settled();
  const after = await it.connection("linear");
  assert.equal(after?.id, id, "the same connection, kept");
  assert.match(after?.about ?? "", /^OPS \(Pier operations\)/);
  assert.ok(it.rows().length > 0);
  assert.ok(
    it.rows().every((row) => !row.id.startsWith("linear:ENG-")),
    "nothing of ENG",
  );
  assert.ok(
    it.made.every((each) => reads.includes(each.call.tool)),
    "never a write tool",
  );
});
