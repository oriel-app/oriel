// Each of the window's workstream actions answers with the call that undoes it,
// and the window sends that call back as it is (decision 0024). What a
// change set's apply does to its workstream is the change set's own doing.
import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  DiffView,
  WorkstreamSummary,
  WorkstreamView,
  ThreadView,
  Undoable,
  UndoView,
} from "@oriel/web/view";
import { json, type Script, testApp } from "./testing.ts";

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
  assert.deepEqual(removed.undo, {
    action: "workstream.add",
    input: { workstream: id, items: ["jira:SYN-10"] },
  });
  await undo(removed.undo);
  assert.deepEqual(keys(await view()), ["SYN-3", "SYN-10"]);

  const added = json<Undoable<WorkstreamView>>(
    await app.post(`/api/workstreams/${id}/add`, { items: ["jira:SYN-3", "jira:SYN-21"] }),
  );
  assert.deepEqual(added.undo, {
    action: "workstream.remove",
    input: { workstream: id, items: ["jira:SYN-21"] },
  });
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
  // An undo answers with its own: undoing it again is a redo.
  assert.deepEqual(redo, { action: "workstream.rename", input: { workstream: id, name: "Beta" } });
});

test("a removal is counted in telemetry; an action by a name Oriel hasn't is not found", async (t) => {
  const app = await testApp(t);
  const { id } = json<WorkstreamSummary>(
    await app.post("/api/workstreams", { kind: "picked", name: "Launch", items: ["jira:SYN-3"] }),
  );
  await app.post(`/api/workstreams/${id}/remove`, { items: ["jira:SYN-3"] });
  const last = app.app.telemetry().at(-1);
  assert.deepEqual(
    [last?.name, last?.data],
    ["action.called", { action: "workstream.remove", by: { kind: "user" } }],
  );
  // Only an Undo goes this way, so only an action that undoes another.
  assert.equal((await app.post("/api/actions/held.discard", { thread: id, seq: 1 })).status, 404);
  assert.equal((await app.post("/api/actions/workstream.create", { kind: "thread" })).status, 404);
  // A workstream from nothing comes only with its thread.
  assert.equal((await app.post("/api/workstreams", { kind: "thread" })).status, 400);
  assert.equal(
    json<{ workstreams: unknown[] }>(await app.get("/api/workstreams")).workstreams.length,
    1,
  );
  assert.equal(
    (await app.post("/api/actions/workstream.add", { workstream: id, items: [] })).status,
    400,
  );
  assert.equal(
    (
      await app.post(
        `/api/actions/workstream.add`,
        { workstream: id, items: ["jira:SYN-3"] },
        {
          origin: "https://attacker.example",
        },
      )
    ).status,
    403,
  );
});

test("a thread's blank workstream takes its epic's name and its items, as the change set's doing", async (t) => {
  const plan: Script = async () => ({
    value: null,
    writes: [["jira.createEpic", [{ summary: "Kiosk wallets" }], "new:1"]],
  });
  const app = await testApp(t, { writes: true, plan: () => [{ run: "plan" }], scripts: { plan } });
  const { id: threadId, workstreamId } = json<{ id: string; workstreamId: string }>(
    await app.post("/api/threads", { text: "Plan kiosk wallets" }),
  );
  await app.app.settled();
  const view = json<ThreadView>(await app.get(`/api/threads/${threadId}`));
  const entry = view.entries.find((e) => e.kind === "change-set");
  assert.ok(entry?.kind === "change-set", "the run captured a change set");
  const { hash } = json<DiffView>(await app.post(`/api/change-sets/${entry.changeSetId}/diff`));
  app.advance(1000);
  await app.post(`/api/change-sets/${entry.changeSetId}/approve`, { hash });
  const after = json<WorkstreamView>(await app.get(`/api/workstreams/${workstreamId}`));
  assert.deepEqual(
    [after.workstream.name, keys(after), after.changes.map((change) => change.cause)],
    ["Kiosk wallets", ["SYN-900"], ["change-set", "user"]],
  );
  const by = { kind: "change-set", changeSetId: entry.changeSetId };
  assert.deepEqual(
    app.app
      .telemetry()
      .filter((e) => e.name === "action.called" || e.name === "workstream.item-added")
      .map((e) => e.data),
    [
      { action: "workstream.rename", by },
      { workstreamId, source: "jira", cause: "change-set" },
    ],
  );
});
