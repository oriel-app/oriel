import assert from "node:assert/strict";
import { test } from "node:test";
import type { WorkstreamSummary, WorkstreamView, Undoable, UndoView } from "@oriel/web/view";
import { json, testApp } from "./testing.ts";

const keys = (view: WorkstreamView) => view.members.map((m) => m.ref.key);

test("removing, adding, dropping and renaming each undo through the call they answer with", async (t) => {
  const app = await testApp(t);
  const { id } = json<WorkstreamSummary>(
    await app.post("/api/workstreams", {
      kind: "picked",
      name: "Launch",
      items: ["jira:SYN-3", "jira:SYN-10"],
    }),
  );
  const view = async () => json<WorkstreamView>(await app.get(`/api/workstreams/${id}`));
  const undo = async (call: UndoView | null) => {
    assert.ok(call, "an undo");
    const reply = await app.post(`/api/actions/${call.action}`, call.input);
    assert.equal(reply.status, 200);
    return json<{ undo: UndoView | null }>(reply).undo;
  };

  const removed = json<Undoable<WorkstreamView>>(
    await app.post(`/api/workstreams/${id}/remove`, { items: ["jira:SYN-10"] }),
  );
  await undo(removed.undo);
  assert.deepEqual(keys(await view()), ["SYN-3", "SYN-10"]);

  const added = json<Undoable<WorkstreamView>>(
    await app.post(`/api/workstreams/${id}/add`, { items: ["jira:SYN-3", "jira:SYN-21"] }),
  );
  await undo(added.undo);
  assert.deepEqual(keys(await view()), ["SYN-3", "SYN-10"]);

  const dropped = json<Undoable<{ added: string[] }>>(
    await app.post(`/api/workstreams/${id}/drop`, { links: ["SYN-21"], files: [] }),
  );
  assert.deepEqual(dropped.added, ["jira:SYN-21"]);
  await undo(dropped.undo);
  assert.deepEqual(keys(await view()), ["SYN-3", "SYN-10"]);

  const renamed = json<Undoable<WorkstreamSummary>>(
    await app.post(`/api/workstreams/${id}/rename`, { name: "Beta" }),
  );
  assert.equal(renamed.name, "Beta");
  const redo = await undo(renamed.undo);
  assert.equal((await view()).workstream.name, "Launch");
  await undo(redo);
  assert.equal((await view()).workstream.name, "Beta");
});

test("the Undo door takes only an action that undoes another", async (t) => {
  const app = await testApp(t);
  const { id } = json<WorkstreamSummary>(
    await app.post("/api/workstreams", { kind: "picked", name: "Launch", items: ["jira:SYN-3"] }),
  );
  assert.equal((await app.post("/api/actions/held.discard", { thread: id, seq: 1 })).status, 404);
  assert.equal((await app.post("/api/actions/workstream.create", { kind: "thread" })).status, 404);
});
