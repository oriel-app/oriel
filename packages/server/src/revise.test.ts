import assert from "node:assert/strict";
import { test } from "node:test";
import type { DiffView, ThreadView } from "@oriel/web/view";
import { scriptedAgent } from "./scripted-agent.ts";
import { estimate, json, type Script, testApp } from "./testing.ts";

const revise: Script = async (bindings) => {
  const sets = (await bindings.read("thread.changeSets", [])).value as {
    id: string;
    state: string;
  }[];
  const waiting = sets.find((set) => set.state === "pending");
  const said = waiting ? (await bindings.read("thread.revise", [waiting.id])).value : null;
  const stories = (await bindings.read("jira.listItems", [])).value as {
    id: string;
    gone: boolean;
    points?: number | null;
    issueType?: string;
  }[];
  const story = stories.find((s) => !s.gone && s.points === null && s.issueType !== "Epic");
  if (!story) throw new Error("the region has no unestimated story");
  return { value: said, writes: [["jira.setEstimate", [story.id, 5]]] };
};

test("asked for a change before anyone decides, the agent revises its own change set in place (OA-309)", async (t) => {
  const app = await testApp(t, {
    memory: true,
    writes: true,
    scripts: { estimate, revise },
    agent: (deps) =>
      scriptedAgent(deps, (input) =>
        input.text === "Estimate"
          ? [{ run: "estimate" }]
          : input.text === "Make it 5"
            ? [{ run: "revise" }]
            : [{ text: "Noted." }],
      ),
  });
  const { id: workstreamId } = json<{ id: string }>(
    await app.post("/api/workstreams", { kind: "cluster", grouping: "epic", cluster: "10001" }),
  );
  const thread = async () => {
    const { id } = json<{ id: string }>(
      await app.post(`/api/workstreams/${workstreamId}/threads`, { text: "Hello" }),
    );
    await app.app.settled();
    return id;
  };
  const ask = async (id: string, text: string) => {
    app.advance(1000);
    await app.post(`/api/threads/${id}/messages`, { text });
    await app.app.settled();
    return json<ThreadView>(await app.get(`/api/threads/${id}`));
  };
  const hashOf = async (set: string) =>
    json<DiffView>(await app.post(`/api/change-sets/${set}/diff`)).hash;

  const first = await thread();
  const proposed = await ask(first, "Estimate");
  const [set] = proposed.changeSets;
  assert.ok(set);
  const old = await hashOf(set.id);

  const revised = await ask(first, "Make it 5");
  assert.deepEqual(
    revised.changeSets.map((s) => [s.id, s.status, s.revisedAt !== null]),
    [[set.id, "open", true]],
  );
  const shown = revised.entries.filter((e) => e.kind === "change-set");
  assert.deepEqual(
    shown.map((e) => e.kind === "change-set" && [e.changeSetId, e.revised ?? false]),
    [
      [set.id, false],
      [set.id, true],
    ],
  );
  const now = await hashOf(set.id);
  assert.notEqual(now, old);
  app.advance(1000);
  const refused = await app.post(`/api/change-sets/${set.id}/approve`, { hash: old });
  assert.equal(refused.status, 409);

  const second = await thread();
  const elsewhere = await ask(second, "Make it 5");
  assert.equal(elsewhere.changeSets.length, 1);
  assert.notEqual(elsewhere.changeSets[0]?.id, set.id);
  assert.equal(await hashOf(set.id), now);

  app.advance(1000);
  assert.equal((await app.post(`/api/change-sets/${set.id}/approve`, { hash: now })).status, 200);
  await app.app.settled();
  const after = await ask(first, "Make it 5");
  assert.equal(after.changeSets.length, 2);
  assert.equal(
    after.changeSets.find((s) => s.id === set.id)?.revisedAt,
    revised.changeSets[0]?.revisedAt,
  );
});
