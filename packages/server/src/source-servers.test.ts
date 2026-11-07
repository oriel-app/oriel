// Source servers (decision 0059, OA-275): what Oriel finds in the person's
// agent, the overview's card of what changed, which kinds are on, the
// agent's turning one off with Undo, and what a kind off hides. The agent's
// answer is faked: no CLI starts.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import type { FoundServer } from "@oriel/core";
import type { ConnectionsView, OverviewView, ThreadView, WindowView } from "@oriel/web/view";
import { tools } from "./mcp/catalogue.ts";
import { fakeAgent, foundTiny, testKnown } from "./servers/testing.ts";
import { json, type Script, testApp } from "./testing.ts";

type Listed = readonly FoundServer[] | { problem: string };

async function world(
  t: TestContext,
  options: { found?: () => Listed; slack?: boolean; connect?: boolean; db?: string } = {},
) {
  const agent = fakeAgent(options.found ?? (() => []));
  // The window chat's agent turns Slack off when asked to stop showing it,
  // and shows its module when asked to.
  const off: Script = async () => ({ intents: [["source.off", [{ kind: "slack" }]]] });
  const inspect: Script = async (bindings) => ({ value: { dts: bindings.dts } });
  const it = await testApp(t, {
    ...(options.db ? { db: options.db } : {}),
    ...(options.connect === false ? {} : { connect: {} }),
    ...(options.slack ? { slack: { mode: "fixture" } } : {}),
    discover: agent.discover,
    knownServers: testKnown,
    plan: (input) =>
      input.text.startsWith("Stop showing me Slack")
        ? [{ run: "off" }]
        : input.text.startsWith("Inspect")
          ? [{ run: "inspect" }]
          : [{ text: "Hello." }],
    scripts: { off, inspect },
  });
  await it.app.settled();
  const connections = () => it.connections();
  const servers = async () => (await connections()).servers;
  const look = async () => json<ConnectionsView>(await it.post("/api/servers/look")).servers;
  const events = (name: string) =>
    it.app
      .telemetry()
      .filter((event) => event.name === name)
      .map((event) => event.data);
  // The window chat's thread, as its page shows it, once its turn ends.
  const ask = async (text: string) => {
    await it.post("/api/window-chat/messages", { text });
    await it.app.settled();
    const thread = json<{ thread: string }>(await it.get("/api/window-chat")).thread;
    return json<ThreadView>(await it.get(`/api/threads/${thread}`));
  };
  return { ...it, agent, servers, look, events, ask };
}

test("a known server Oriel finds is offered on the overview's card, never turned on by itself", async (t) => {
  const it = await world(t, { found: () => [foundTiny()] });
  const servers = await it.look();
  assert.equal(servers.agent, "Claude Code");
  assert.deepEqual(servers.found, [
    { kind: "jira", server: "work-tracker", known: "Oriel's test tracker server", on: false },
  ]);
  assert.deepEqual(servers.card, { appeared: servers.found, gone: [] });
  // Offered, not on: the stand-in still holds the tracker's place.
  assert.deepEqual((await it.connections()).standingIn, ["tracker"]);
  assert.deepEqual(servers.kinds, []);
});

test("a server missing a read tool, or one Oriel doesn't know, is never offered", async (t) => {
  const it = await world(t, {
    found: () => [
      foundTiny({ tools: ["search_issues", "create_issue"] }),
      foundTiny({ name: "shell", reports: "my-shell" }),
    ],
  });
  const servers = await it.look();
  assert.deepEqual(servers.found, []);
  assert.equal(servers.card, null);
  // What would turn Jira on is named, with its vendor's own instructions.
  assert.deepEqual(servers.missing, [
    {
      kind: "jira",
      server: "Oriel's test tracker server",
      instructions: "https://example.invalid/oriel-test-tracker",
    },
  ]);
});

test("the card goes once dismissed, and stays gone for the same finds, but a new change brings it back", async (t) => {
  let found: FoundServer[] = [foundTiny()];
  const it = await world(t, { found: () => found });
  assert.notEqual((await it.look()).card, null);
  assert.equal((await it.post("/api/servers/dismiss")).status, 200);
  assert.equal((await it.servers()).card, null);
  // Oriel opens again, or the person presses sync: the same server, no card.
  assert.equal((await it.look()).card, null);
  // The server goes from the agent: that's a change, said on the card.
  found = [];
  assert.deepEqual((await it.look()).card, {
    appeared: [],
    gone: [{ kind: "jira", server: "work-tracker", on: false }],
  });
});

test("turning a tracker kind on through its server steps the stand-in aside, and its going turns it off again", async (t) => {
  let found: FoundServer[] = [foundTiny()];
  const it = await world(t, { found: () => found, connect: true });
  await it.look();
  const on = await it.post("/api/actions/source.on", { kind: "jira", server: "work-tracker" });
  assert.equal(on.status, 200);
  assert.deepEqual(json(on), { undo: { action: "source.off", input: { kind: "jira" } } });
  let servers = await it.servers();
  assert.deepEqual(servers.kinds, [
    { kind: "jira", on: true, server: "work-tracker", offBy: null },
  ]);
  // The stand-in tracker is on only while no tracker kind is.
  assert.deepEqual((await it.connections()).standingIn, []);
  assert.equal(servers.card, null, "nothing left on the card to turn on");
  // The server is gone from the agent: Jira is off, and the stand-in is back.
  found = [];
  servers = await it.look();
  assert.deepEqual(servers.kinds, []);
  assert.deepEqual((await it.connections()).standingIn, ["tracker"]);
  assert.deepEqual(it.events("source.turned"), [{ source: "jira", on: true, by: "person" }]);
});

test("a kind stays on only through the server the person picked, not another reporting its name", async (t) => {
  const picked = foundTiny();
  const other = foundTiny({ name: "lookalike", command: "node elsewhere.ts" });
  let found: FoundServer[] = [picked, other];
  const it = await world(t, { found: () => found, connect: true });
  await it.look();
  const on = await it.post("/api/actions/source.on", { kind: "jira", server: "work-tracker" });
  assert.equal(on.status, 200);
  // The picked one goes; the lookalike, reporting the same name, stays.
  found = [other];
  let servers = await it.look();
  assert.deepEqual(servers.kinds, []);
  assert.deepEqual((await it.connections()).standingIn, ["tracker"]);
  // The picked one is back: on again, through it.
  found = [other, picked];
  servers = await it.look();
  assert.deepEqual(servers.kinds, [
    { kind: "jira", on: true, server: "work-tracker", offBy: null },
  ]);
});

test("a server Oriel didn't find can't be turned on, and a look that fails names the agent and keeps what's on", async (t) => {
  let found: Listed = [foundTiny()];
  const it = await world(t, { found: () => found });
  await it.look();
  const stranger = await it.post("/api/actions/source.on", { kind: "jira", server: "elsewhere" });
  assert.equal(stranger.status, 409);
  assert.equal((await it.post("/api/actions/source.on", { kind: "slack" })).status, 409);
  assert.equal(
    (await it.post("/api/actions/source.on", { kind: "jira", server: "work-tracker" })).status,
    200,
  );
  found = { problem: "it stopped before it answered" };
  const servers = await it.look();
  assert.equal(
    servers.problem,
    "Claude Code didn't list its MCP servers: it stopped before it answered",
  );
  assert.deepEqual(
    servers.kinds.map((each) => [each.kind, each.on]),
    [["jira", true]],
  );
});

test("the window chat's agent turns Slack off, with an Undo that turns it on again", async (t) => {
  const it = await world(t, { slack: true });
  const slackRows = async () =>
    it.app
      .window("epic")
      .clusters.flatMap((c) => c.list)
      .filter((row) => row.id.startsWith("slack:")).length;
  assert.equal(await slackRows(), 19);
  const view = await it.ask("Stop showing me Slack");
  const line = view.entries.flatMap((entry) => (entry.kind === "actions" ? entry.lines : []))[0];
  assert.ok(line);
  assert.match(line.text, /^Turned Slack off/);
  assert.deepEqual(line.undo, { action: "source.on", input: { kind: "slack" } });
  assert.equal(await slackRows(), 0);
  const servers = await it.servers();
  assert.deepEqual(servers.kinds, [{ kind: "slack", on: false, server: null, offBy: "agent" }]);
  assert.deepEqual(it.events("source.turned"), [{ source: "slack", on: false, by: "agent" }]);
  // Undo, from the line under its reply: Slack shows again, as it was.
  const undone = await it.post("/api/actions/source.on", line.undo?.input);
  assert.equal(undone.status, 200);
  assert.equal(await slackRows(), 19);
  assert.deepEqual(it.events("source.turned").at(-1), {
    source: "slack",
    on: true,
    by: "person",
  });
});

test("with a kind off, none of its surfaces shows, with no greyed-out version", async (t) => {
  const it = await world(t, { slack: true, connect: false });
  const before = await it.connections();
  assert.ok(before.connections.some((each) => each.kind === "slack"));
  const messages = it.app.window("epic").clusters.flatMap((c) => c.list);
  assert.ok(messages.some((row) => row.id.startsWith("slack:")));
  assert.equal((await it.post("/api/actions/source.off", { kind: "slack" })).status, 200);
  // Settings' connection rows, and Slack among what may be connected.
  const after = await it.connections();
  assert.ok(!after.connections.some((each) => each.kind === "slack"));
  assert.ok(!after.connectable.includes("slack"));
  // Browse, by source and under every grouping.
  for (const grouping of ["epic", "assignee", "stuck", "linked"]) {
    const view = json<WindowView>(await it.get(`/api/browse?grouping=${grouping}`));
    assert.ok(
      view.choices?.sources.some((each) => each.id === "jira"),
      grouping,
    );
    assert.ok(!view.choices?.sources.some((each) => each.id === "slack"), grouping);
    const all = it.app.window(grouping as "epic").clusters.flatMap((c) => c.list);
    assert.ok(!all.some((row) => row.id.startsWith("slack:")), grouping);
  }
  // The overview: nothing of Slack among what no workstream holds.
  const overview = json<OverviewView>(await it.get("/api/overview"));
  assert.doesNotMatch(JSON.stringify(overview.candidates), /slack:/);
  // The agent's module: no Slack namespace, no Slack item doc.
  const { dts } = await moduleOf(it);
  assert.match(dts, /declare const jira/);
  assert.doesNotMatch(dts, /declare const slack/);
  assert.doesNotMatch(dts, /Slack/);
  // Turned on again, it's all back.
  assert.equal((await it.post("/api/actions/source.on", { kind: "slack" })).status, 200);
  assert.ok((await it.connections()).connections.some((each) => each.kind === "slack"));
});

test("what's off stays off when Oriel opens again", async (t) => {
  const top = mkdtempSync(join(tmpdir(), "oriel-servers-"));
  t.after(() => rmSync(top, { recursive: true, force: true }));
  const db = join(top, "window.db");
  const first = await world(t, { slack: true, db });
  assert.equal((await first.post("/api/actions/source.off", { kind: "slack" })).status, 200);
  await first.app.close();
  const again = await world(t, { slack: true, db });
  assert.ok(!(await again.connections()).connections.some((each) => each.kind === "slack"));
});

test("an outside tool can't turn a kind on, nor off, and the agent has no way to turn one on", async (t) => {
  const it = await world(t, { slack: true });
  const names = tools.map((tool) => tool.name);
  assert.ok(!names.includes("source_on") && !names.includes("source_off"), names.join());
  const tool = { kind: "tool", name: "Helper" } as const;
  await assert.rejects(
    it.app.outside.dispatch.untyped("source.on", { kind: "slack" }, tool),
    /source\.on is the user's/,
  );
  await assert.rejects(
    it.app.outside.dispatch.untyped("source.off", { kind: "slack" }, tool),
    /closed to tools/,
  );
  const agent = { kind: "agent", threadId: "01JC0NNECT10N0000000000000" } as const;
  await assert.rejects(
    it.app.outside.dispatch.untyped("source.on", { kind: "slack" }, agent as never),
    /source\.on is the user's/,
  );
});

// A window chat run's module, as the agent's run tool holds it.
async function moduleOf(it: Awaited<ReturnType<typeof world>>): Promise<{ dts: string }> {
  const view = await it.ask("Inspect your module");
  const finished = view.entries.findLast((entry) => entry.kind === "run.finished");
  assert.ok(finished?.kind === "run.finished");
  return JSON.parse(finished.run.returned ?? "null") as { dts: string };
}

test("a workstream's members of a kind turned off don't show, and are back once it's on", async (t) => {
  const it = await world(t, { slack: true, connect: false });
  const message = "slack:C0FW1WEATHR-1788444000.000100";
  const { id } = json<{ id: string }>(
    await it.post("/api/workstreams", {
      kind: "picked",
      name: "Fares",
      items: ["jira:SYN-45", message],
    }),
  );
  const shown = async () => {
    const view = json<{ members: { ref: { id: string } }[] }>(
      await it.get(`/api/workstreams/${id}`),
    );
    const card = json<OverviewView>(await it.get("/api/overview")).workstreams.find(
      (row) => row.id === id,
    );
    return [view.members.map((m) => m.ref.id), card?.size];
  };
  assert.deepEqual(await shown(), [["jira:SYN-45", message], 2]);
  assert.equal((await it.post("/api/actions/source.off", { kind: "slack" })).status, 200);
  assert.deepEqual(await shown(), [["jira:SYN-45"], 1]);
  assert.equal((await it.post("/api/actions/source.on", { kind: "slack" })).status, 200);
  assert.deepEqual(await shown(), [["jira:SYN-45", message], 2]);
});

test("a kind whose server went has no namespace or item doc in the agent's module", async (t) => {
  let found: FoundServer[] = [foundTiny()];
  const it = await world(t, { found: () => found, connect: true });
  await it.look();
  await it.post("/api/actions/source.on", { kind: "jira", server: "work-tracker" });
  found = [];
  await it.look();
  const { dts } = await moduleOf(it);
  assert.doesNotMatch(dts, /declare const jira/);
});

test("a look asked while one runs asks again once it ends, so a new agent is asked", async (t) => {
  let calls = 0;
  const it = await world(t, {
    found: () => {
      calls += 1;
      return [];
    },
  });
  calls = 0;
  await Promise.all([it.look(), it.look(), it.look()]);
  assert.equal(calls, 2, "the running look, then one more for every ask meanwhile");
});
