import assert from "node:assert/strict";
import { test } from "node:test";
import type { IndexRecord, WorkstreamMember } from "@oriel/core";
import type { ThreadView } from "@oriel/web/view";
import type { Agent } from "./agent.ts";
import { json, testApp } from "./testing.ts";
import { memberOf } from "./views.ts";

const checkout = { kind: "cluster", grouping: "epic", cluster: "10001" };

async function thread(t: Parameters<typeof testApp>[0], options: Parameters<typeof testApp>[1]) {
  const app = await testApp(t, options);
  const { id: workstreamId } = json<{ id: string }>(await app.post("/api/workstreams", checkout));
  const opened = await app.post(`/api/workstreams/${workstreamId}/threads`, { text: "One" });
  const { id } = json<{ id: string }>(opened);
  await app.app.settled();
  const view = async () => json<ThreadView>(await app.get(`/api/threads/${id}`));
  const say = async (text: string) => {
    const reply = await app.post(`/api/threads/${id}/messages`, { text });
    await app.app.settled();
    return reply;
  };
  return { ...app, workstreamId, id, view, say };
}

test("a thread that has asked its last question takes no more, and says why", async (t) => {
  const app = await thread(t, { limits: { maxTurnsPerThread: 2 } });
  assert.equal((await app.say("Two")).status, 202);
  const refused = await app.say("Three");
  assert.equal(refused.status, 409);
  const after = await app.view();
  assert.equal(after.entries.at(-1)?.kind, "limit");
  assert.equal(after.entries.filter((e) => e.kind === "user").length, 2);
  assert.equal((await app.say("Four")).status, 409);
  assert.equal((await app.view()).entries.length, after.entries.length);
});

test("a thread that has spent its tokens takes no more, whatever the agent does", async (t) => {
  const spending: Agent = {
    async *turn() {
      yield { kind: "done", usage: { inputTokens: 6, outputTokens: 5 } };
    },
  };
  // This agent never says it has reached a cap; the server holds it anyway.
  const app = await thread(t, { agent: () => spending, limits: { maxTokensPerThread: 10 } });
  const refused = await app.say("Two");
  assert.equal(refused.status, 409);
  assert.equal((await app.view()).entries.at(-1)?.kind, "limit");
});

test("the window's telemetry keeps nothing but the event: unknown events and fields are refused", async (t) => {
  const app = await testApp(t);
  const send = (body: unknown) => app.post("/api/telemetry", body);
  const before = app.app.telemetry().length;
  // Only that it was regrouped, never by what.
  assert.equal((await send({ name: "block.regrouped", rows: "assignee" })).status, 202);
  assert.deepEqual(app.app.telemetry().at(-1)?.data, {});
  for (const bad of [
    { name: "changeset.decided", changeSetId: "x" },
    { name: "grouping.switched", grouping: "toString" },
  ])
    assert.equal((await send(bad)).status, 400, JSON.stringify(bad));
  assert.equal(
    (await send({ name: "grouping.switched", grouping: "epic", pad: "x".repeat(300) })).status,
    413,
  );
  assert.equal(app.app.telemetry().length, before + 1);
});

test("a member is found by identity, so a moved item is removed under its new handle", () => {
  const record = (id: string, stableId: string) => ({ id, stableId }) as IndexRecord;
  const held: WorkstreamMember[] = [
    { id: "jira:SYN-5", stableId: "10005" },
    { id: "jira:SYN-6", stableId: "10006" },
  ];
  // SYN-5 moved to another project; SYN-6 was deleted, and its key reused by another item.
  const records = [record("jira:OA-1", "10005"), record("jira:SYN-6", "20006")];
  assert.equal(memberOf("jira:OA-1", held, records), held[0]);
  assert.equal(memberOf("jira:SYN-6", held, records), held[1]);
  assert.equal(memberOf("jira:SYN-5", held, records), undefined);
  assert.equal(memberOf("jira:SYN-7", held, records), undefined);
  // Still under its old handle while the index has it there.
  assert.equal(memberOf("jira:SYN-5", held, [record("jira:SYN-5", "10005")]), held[0]);
});
