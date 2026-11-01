// A Jira board that takes no estimates, as a team-managed one with no points
// field: SYN in memory, synced live, with a board that counts issues.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChangeSetView, DiffView, ThreadView, WindowView } from "@oriel/web/view";
import type { TurnInput } from "./agent.ts";
import { devPlan, scriptedAgent, type Step } from "./scripted-agent.ts";
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
    "jira.setEstimate: SYN's board takes no estimates, so jira:SYN-23 can't be estimated";
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
    /Nothing to propose: jira\.setEstimate: SYN's board takes no estimates, so jira:SYN-23 can't be estimated\./,
  );
  assert.doesNotMatch(said, /The proposed change is below/);
});

// What the agent's module says about SYN-23: whether its item has points.
const pointed: Script = async (bindings) => {
  const { value } = await bindings.read("jira.getItem", ["jira:SYN-23"]);
  return { value: value !== null && typeof value === "object" && "points" in value };
};

test("the agent's item has no points on a board that takes no estimates, and null points on one that does", async (t) => {
  for (const estimates of [false, true]) {
    const app = await testApp(t, {
      live: true,
      ...(estimates ? {} : { estimates: false as const }),
      plan: () => [{ run: "pointed" }],
      scripts: { pointed },
    });
    const { id: groupId } = json<{ id: string }>(await app.post("/api/groups", checkout));
    const { id: threadId } = json<{ id: string }>(
      await app.post(`/api/groups/${groupId}/threads`, { text: "Has SYN-23 points?" }),
    );
    await app.app.settled();
    const view = json<ThreadView>(await app.get(`/api/threads/${threadId}`));
    const finished = view.entries.find((e) => e.kind === "run.finished");
    assert.equal(finished?.kind === "run.finished" && finished.run.returned, String(estimates));
  }
});

const estimateSyn23: Script = async () => ({ writes: [["jira.setEstimate", ["jira:SYN-23", 3]]] });

test("a board that stops taking estimates is followed from the next sync, without a restart", async (t) => {
  const app = await testApp(t, {
    live: true,
    plan: () => [{ run: "estimate" }],
    scripts: { estimate: estimateSyn23 },
  });
  const { id: groupId } = json<{ id: string }>(await app.post("/api/groups", checkout));
  const ask = async (text: string) => {
    const { id } = json<{ id: string }>(await app.post(`/api/groups/${groupId}/threads`, { text }));
    await app.app.settled();
    return json<ThreadView>(await app.get(`/api/threads/${id}`)).entries;
  };
  const proposed = (await ask("Estimate SYN-23")).find((e) => e.kind === "change-set");
  assert.ok(proposed?.kind === "change-set");

  app.site?.estimation(false);
  assert.equal((await app.post("/api/jira/sync")).status, 200);
  // The writer: approving the estimate proposed before writes nothing.
  const { hash } = json<DiffView>(await app.post(`/api/change-sets/${proposed.changeSetId}/diff`));
  const approved = json<{ changeSet: ChangeSetView }>(
    await app.post(`/api/change-sets/${proposed.changeSetId}/approve`, { hash }),
  );
  assert.notEqual(approved.changeSet.status, "applied");
  assert.match(approved.changeSet.errors[0]?.error ?? "", /SYN's board has no points field/);
  assert.equal(app.site?.issue("SYN-23")?.points, null);
  // The agent's module: a new estimate is refused when captured.
  const again = await ask("Estimate SYN-23 again");
  assert.ok(again.every((e) => e.kind !== "change-set"));
  assert.match(JSON.stringify(again), /SYN's board takes no estimates/);
});

// The sandbox and the dev agent as `pnpm dev` runs them. This spawns Deno.
async function devApp(t: Parameters<typeof testApp>[0], plan: (input: TurnInput) => Step[]) {
  const { createSandbox } = await import("@oriel/sandbox");
  const sandbox = createSandbox();
  const app = await testApp(t, {
    live: true,
    estimates: false,
    agent: (deps) => scriptedAgent({ ...deps, sandbox }, plan),
  });
  const { id: groupId } = json<{ id: string }>(await app.post("/api/groups", checkout));
  const { id: threadId } = json<{ id: string }>(
    await app.post(`/api/groups/${groupId}/threads`, { text: "Estimate the unestimated ones" }),
  );
  await app.app.settled();
  return JSON.stringify(json<ThreadView>(await app.get(`/api/threads/${threadId}`)).entries);
}

test("a refused write's message names the function once, and the dev agent says it as it is", async (t) => {
  const said = await devApp(t, () => [{ run: 'jira.setEstimate("jira:SYN-23", 3);\nreturn 1;' }]);
  assert.match(
    said,
    /Nothing to propose: jira\.setEstimate: SYN's board takes no estimates, so jira:SYN-23 can't be estimated\./,
  );
  assert.equal(said.match(/Nothing to propose: [^"]*/)?.[0].split("setEstimate").length, 2);
});

test("on a board that takes no estimates, the dev agent finds nothing to estimate", async (t) => {
  const said = await devApp(t, devPlan);
  assert.match(said, /"returned":"\[\]"/);
  assert.doesNotMatch(said, /change-set|Nothing to propose/);
});
