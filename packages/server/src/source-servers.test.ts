// Source servers (decision 0059, OA-275): which of what Oriel finds in the
// person's agent may be turned on, by whom, and through which server. The
// agent's answer is faked: no CLI starts.
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import type { FoundServer } from "@oriel/core";
import type { ConnectionsView } from "@oriel/web/view";
import { tools } from "./mcp/catalogue.ts";
import { fakeAgent, foundTiny, testKnown } from "./servers/testing.ts";
import { json, testApp } from "./testing.ts";

type Listed = readonly FoundServer[] | { problem: string };

async function world(
  t: TestContext,
  options: { found?: () => Listed; slack?: boolean; connect?: boolean } = {},
) {
  const agent = fakeAgent(options.found ?? (() => []));
  const it = await testApp(t, {
    ...(options.connect === false ? {} : { connect: {} }),
    ...(options.slack ? { slack: { mode: "fixture" } } : {}),
    discover: agent.discover,
    knownServers: testKnown,
  });
  await it.app.settled();
  const servers = async () => (await it.connections()).servers;
  const look = async () => json<ConnectionsView>(await it.post("/api/servers/look")).servers;
  return { ...it, servers, look };
}

test("a known server Oriel finds is offered on the overview's card, never turned on by itself", async (t) => {
  const it = await world(t, { found: () => [foundTiny()] });
  const servers = await it.look();
  assert.deepEqual(
    servers.found.map((each) => [each.server, each.on]),
    [["work-tracker", false]],
  );
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
  assert.deepEqual(
    servers.kinds.map((each) => [each.kind, each.on, each.server]),
    [["jira", true, "work-tracker"]],
  );
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
  assert.ok(servers.problem);
  assert.deepEqual(
    servers.kinds.map((each) => [each.kind, each.on]),
    [["jira", true]],
  );
});

test("an outside tool can't turn a kind on, nor off, and the agent has no way to turn one on", async (t) => {
  const it = await world(t, { slack: true });
  const names = tools.map((tool) => tool.name);
  assert.ok(!names.includes("source_on") && !names.includes("source_off"), names.join());
  const tool = { kind: "tool", name: "Helper" } as const;
  await assert.rejects(it.app.outside.dispatch.untyped("source.on", { kind: "slack" }, tool));
  await assert.rejects(it.app.outside.dispatch.untyped("source.off", { kind: "slack" }, tool));
  const agent = { kind: "agent", threadId: "01JC0NNECT10N0000000000000" } as const;
  await assert.rejects(
    it.app.outside.dispatch.untyped("source.on", { kind: "slack" }, agent as never),
  );
});
