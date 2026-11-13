import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import type { ChangeSetView, DiffView, ThreadView } from "@oriel/web/view";
import type { Agent } from "./agent.ts";
import { json, type Script, testApp } from "./testing.ts";

const checkout = { kind: "cluster", grouping: "epic", cluster: "10001" };
const estimate: Script = async () => ({
  value: null,
  writes: [["jira.setEstimate", ["jira:SYN-23", 3]]],
});

async function thread(t: TestContext, options: Parameters<typeof testApp>[1] = {}) {
  const app = await testApp(t, options);
  const { id: workstreamId } = json<{ id: string }>(await app.post("/api/workstreams", checkout));
  const { id: threadId } = json<{ id: string }>(
    await app.post(`/api/workstreams/${workstreamId}/threads`, { text: "Estimate SYN-23" }),
  );
  await app.app.settled();
  return { ...app, threadId };
}

test("a deleted thread's change sets are out of reach, here and by a review link", async (t) => {
  const app = await thread(t, {
    writes: true,
    plan: () => [{ run: "estimate" }],
    scripts: { estimate },
  });
  const entry = json<ThreadView>(await app.get(`/api/threads/${app.threadId}`)).entries.find(
    (e) => e.kind === "change-set",
  );
  assert.ok(entry?.kind === "change-set");
  const { hash } = json<DiffView>(await app.post(`/api/change-sets/${entry.changeSetId}/diff`));
  app.advance(1000);
  const approved = json<{ changeSet: ChangeSetView }>(
    await app.post(`/api/change-sets/${entry.changeSetId}/approve`, { hash }),
  );
  assert.equal(approved.changeSet.status, "applied");
  assert.equal((await app.post(`/api/threads/${app.threadId}/delete`)).status, 200);
  assert.equal((await app.get(`/api/threads/${app.threadId}`)).status, 404);
  assert.equal((await app.post(`/api/change-sets/${entry.changeSetId}/revert`)).status, 404);
  assert.equal((await app.post(`/api/change-sets/${entry.changeSetId}/review-link`)).status, 404);
  assert.equal(app.site?.issue("SYN-23")?.points, 3, "what it wrote stays in Jira");
});

const answering: Agent = {
  async *turn(_input, { signal }) {
    await new Promise((resolve) => signal.addEventListener("abort", resolve));
    yield { kind: "done", usage: { inputTokens: 0, outputTokens: 0 } };
  },
};

test("a thread whose agent is answering isn't deleted", async (t) => {
  const app = await testApp(t, { agent: () => answering });
  const { id: workstreamId } = json<{ id: string }>(await app.post("/api/workstreams", checkout));
  const { id } = json<{ id: string }>(
    await app.post(`/api/workstreams/${workstreamId}/threads`, { text: "Think" }),
  );
  const refused = await app.post(`/api/threads/${id}/delete`);
  assert.equal(refused.status, 409);
  await app.post(`/api/threads/${id}/stop`);
  await app.app.settled();
  assert.equal((await app.post(`/api/threads/${id}/delete`)).status, 200);
});
