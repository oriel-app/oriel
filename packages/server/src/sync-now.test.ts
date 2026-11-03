// Sync now, in a thread's right rail: a thread behind its workstream catches
// up as the user's next message would make it, with the same marker,
// without one.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Agent } from "./agent.ts";
import type { ChatEntry, ThreadView } from "@oriel/web/view";
import { json, testApp } from "./testing.ts";

const checkout = { kind: "cluster", grouping: "epic", cluster: "10001" };

test("Sync now moves a thread left behind to its workstream's latest version, with a marker", async (t) => {
  const app = await testApp(t);
  const { id: workstreamId } = json<{ id: string }>(await app.post("/api/workstreams", checkout));
  const { id } = json<{ id: string }>(
    await app.post(`/api/workstreams/${workstreamId}/threads`, { text: "Hello" }),
  );
  await app.app.settled();
  const view = async () => json<ThreadView>(await app.get(`/api/threads/${id}`));
  const markers = (shown: ThreadView) =>
    shown.entries.filter((e: ChatEntry) => e.kind === "marker");
  // A thread marked done keeps its version while its workstream changes.
  app.advance(1000);
  await app.post(`/api/threads/${id}/done`, {});
  await app.post(`/api/workstreams/${workstreamId}/remove`, { items: ["jira:SYN-10"] });
  const behind = await view();
  assert.equal(behind.regionVersion, behind.workstream.version - 1);
  assert.ok(behind.members.some((member) => member.ref.key === "SYN-10"));

  const synced = await app.post(`/api/threads/${id}/sync`);
  assert.equal(synced.status, 200);
  const caught = json<ThreadView>(synced);
  assert.equal(caught.regionVersion, caught.workstream.version);
  assert.ok(!caught.members.some((member) => member.ref.key === "SYN-10"));
  const [marker] = markers(caught);
  assert.ok(marker?.kind === "marker");
  assert.deepEqual(
    marker.removed.map((ref) => ref.key),
    ["SYN-10"],
  );
  // It stays done: only the user's message makes it work again.
  assert.equal(caught.state, "done");
  assert.deepEqual(app.app.telemetry().at(-1)?.data, {
    action: "thread.sync",
    by: { kind: "user" },
  });

  // At the latest version already, it stays there, with no second marker.
  assert.equal((await app.post(`/api/threads/${id}/sync`)).status, 200);
  assert.equal(markers(await view()).length, 1);
});

// Answers until stopped.
const answering: Agent = {
  async *turn(_input, { signal }) {
    await new Promise((resolve) => signal.addEventListener("abort", resolve));
    yield { kind: "done", usage: { inputTokens: 0, outputTokens: 0 } };
  },
};

test("Sync now waits while the thread's agent answers", async (t) => {
  const app = await testApp(t, { agent: () => answering });
  const { id: workstreamId } = json<{ id: string }>(await app.post("/api/workstreams", checkout));
  const { id } = json<{ id: string }>(
    await app.post(`/api/workstreams/${workstreamId}/threads`, { text: "Think" }),
  );
  const refused = await app.post(`/api/threads/${id}/sync`);
  assert.equal(refused.status, 409);
  assert.match(json<{ error: string }>(refused).error, /still answering/);
  await app.post(`/api/threads/${id}/stop`);
  await app.app.settled();
  assert.equal((await app.post(`/api/threads/${id}/sync`)).status, 200);
});
