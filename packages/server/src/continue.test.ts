import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import type { ContinuedView, ThreadView, Undoable } from "@oriel/web/view";
import { json, testApp } from "./testing.ts";

async function continued(t: TestContext) {
  const app = await testApp(t);
  const checkout = { kind: "cluster", grouping: "epic", cluster: "10001" };
  const { id: from } = json<{ id: string }>(await app.post("/api/workstreams", checkout));
  const gifts = { kind: "picked", name: "Gift cards", items: ["jira:SYN-104"] };
  const { id: to } = json<{ id: string }>(await app.post("/api/workstreams", gifts));
  const { id: old } = json<{ id: string }>(
    await app.post(`/api/workstreams/${from}/threads`, { text: "What's left on checkout?" }),
  );
  await app.app.settled();
  app.advance(1000);
  const reply = await app.post(`/api/threads/${old}/continue`, { workstream: to });
  assert.equal(reply.status, 201);
  const moved = json<Undoable<ContinuedView>>(reply);
  assert.ok(moved.undo);
  const view = (id: string) => app.get(`/api/threads/${id}`);
  return { app, old, moved, undo: moved.undo, view, to };
}

test("Continue in… holds the conversation in a new thread, and its Undo gives the old one back", async (t) => {
  const { app, old, moved, undo, view, to } = await continued(t);
  assert.equal(moved.kept, false);
  assert.equal(json<ThreadView>(await view(old)).state, "done");
  const opened = json<ThreadView>(await view(moved.thread));
  assert.equal(opened.workstream.id, to);
  const held = opened.entries.find((e) => e.kind === "held");
  assert.ok(held?.kind === "held" && held.from.kind === "thread" && held.from.threadId === old);
  assert.equal(held.outcome, null);
  assert.ok(!opened.entries.some((e) => e.kind === "user"), "the quote isn't the user's words");
  assert.equal((await app.post(`/api/actions/${undo.action}`, undo.input)).status, 200);
  assert.equal((await view(moved.thread)).status, 404);
  assert.equal(json<ThreadView>(await view(old)).state, "working");
});

test("Continue in…'s Undo keeps a new thread something was said in", async (t) => {
  const { app, old, moved, undo, view } = await continued(t);
  await app.post(`/api/threads/${moved.thread}/messages`, { text: "Go on from there" });
  await app.app.settled();
  assert.equal((await app.post(`/api/actions/${undo.action}`, undo.input)).status, 409);
  assert.equal((await view(moved.thread)).status, 200);
  assert.equal(json<ThreadView>(await view(old)).state, "done");
});
