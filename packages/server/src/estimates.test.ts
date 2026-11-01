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
