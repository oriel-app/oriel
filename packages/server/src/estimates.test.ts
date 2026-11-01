// A Jira board that takes no estimates, as a team-managed one with no points
// field: SYN in memory, synced live, with a board that counts issues.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ThreadView, WindowView } from "@oriel/web/view";
import { json, type Script, testApp } from "./testing.ts";

// SYN-1's epic, whose stories SYN-23, SYN-99 and SYN-104 have no points.
const checkout = { kind: "cluster", grouping: "epic", cluster: "10001" };

// What the agent would see: the refusal, caught, as the run's value.
const estimate: Script = async (bindings) => {
  try {
    bindings.capture("jira.setEstimate", ["jira:SYN-23", 3], null);
    return { value: "captured" };
  } catch (error) {
    return { value: error instanceof Error ? error.message : String(error) };
  }
};

test("a board that takes no estimates shows no unestimated counts and no Unestimated cluster", async (t) => {
  const app = await testApp(t, { live: true, estimates: false });
  const byEpic = json<WindowView>(await app.get("/api/window?grouping=epic"));
  assert.ok(byEpic.items > 0);
  const rows = byEpic.clusters.flatMap((c) => [...(c.row.anchor ? [c.row.anchor] : []), ...c.list]);
  assert.ok(rows.length > 0);
  assert.ok(byEpic.clusters.every((c) => c.row.unestimated === 0 && c.row.estimated === 0));
  assert.ok(rows.every((row) => row.noEstimates === true && row.points === null));
  const stuck = json<WindowView>(await app.get("/api/window?grouping=stuck"));
  assert.deepEqual(
    stuck.clusters.map((c) => c.row.key),
    ["no-update-14-days"],
  );
});

test("a board that estimates keeps its counts and its Unestimated cluster", async (t) => {
  const app = await testApp(t, { live: true });
  const byEpic = json<WindowView>(await app.get("/api/window?grouping=epic"));
  assert.ok(byEpic.clusters.some((c) => c.row.unestimated > 0));
  assert.ok(byEpic.clusters.flatMap((c) => c.list).every((row) => row.noEstimates === undefined));
  const stuck = json<WindowView>(await app.get("/api/window?grouping=stuck"));
  assert.deepEqual(
    stuck.clusters.map((c) => c.row.key),
    ["no-update-14-days", "unestimated"],
  );
});

test("on a board that takes no estimates, a run that estimates is told why and proposes nothing", async (t) => {
  const app = await testApp(t, {
    live: true,
    estimates: false,
    plan: () => [{ run: "estimate" }],
    scripts: { estimate },
  });
  const { id: groupId } = json<{ id: string }>(await app.post("/api/groups", checkout));
  const { id: threadId } = json<{ id: string }>(
    await app.post(`/api/groups/${groupId}/threads`, { text: "Estimate the unestimated ones" }),
  );
  await app.app.settled();
  const view = json<ThreadView>(await app.get(`/api/threads/${threadId}`));
  assert.ok(view.entries.every((e) => e.kind !== "change-set"));
  assert.match(
    JSON.stringify(view.entries),
    /SYN's board takes no estimates, so jira:SYN-23 can't be estimated/,
  );
});

// A plan from nothing: an epic, and a story in it with points.
const plan: Script = async (bindings) => {
  bindings.capture("jira.createEpic", [{ summary: "Kiosk wallets" }], "new:1");
  try {
    bindings.capture(
      "jira.createStory",
      [{ summary: "Tap to pay", points: 3, epic: "new:1" }],
      "new:2",
    );
    return { value: "captured" };
  } catch (error) {
    return { value: error instanceof Error ? error.message : String(error) };
  }
};

test("a project with no items yet is known to take no estimates from its board", async (t) => {
  const app = await testApp(t, {
    live: true,
    estimates: false,
    issues: () => [],
    plan: () => [{ run: "plan" }],
    scripts: { plan },
  });
  const { id: threadId } = json<{ id: string }>(
    await app.post("/api/threads", { text: "Plan kiosk wallets, with estimates" }),
  );
  await app.app.settled();
  const view = json<ThreadView>(await app.get(`/api/threads/${threadId}`));
  assert.match(
    JSON.stringify(view.entries),
    /SYN's board takes no estimates, so create the story without points/,
  );
});

test("the scripted agent says why a run failed instead of pointing to a change set", async (t) => {
  const refused =
    "jira.setEstimate was refused: jira.setEstimate: SYN's board takes no estimates, so jira:SYN-23 can't be estimated";
  const app = await testApp(t, {
    plan: () => [{ run: "estimate" }, { text: "The proposed change is below." }],
    sandbox: {
      run: async () => ({
        reads: [],
        mutations: [],
        transcript: [{ kind: "error", error: { phase: "runtime", message: refused, logs: [] } }],
        outcome: "threw",
        wallMs: 1,
        coldStartMs: null,
      }),
    },
  });
  const { id: groupId } = json<{ id: string }>(await app.post("/api/groups", checkout));
  const { id: threadId } = json<{ id: string }>(
    await app.post(`/api/groups/${groupId}/threads`, { text: "Estimate the unestimated ones" }),
  );
  await app.app.settled();
  const said = JSON.stringify(json<ThreadView>(await app.get(`/api/threads/${threadId}`)).entries);
  assert.match(
    said,
    /Nothing to propose: SYN's board takes no estimates, so jira:SYN-23 can't be estimated\./,
  );
  assert.doesNotMatch(said, /The proposed change is below/);
});
