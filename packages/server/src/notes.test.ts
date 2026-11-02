// Oriel's own lines in a thread, such as asking what was wrong with a
// rejected change set, are notes: never the agent's text, in the chat or in
// what the agent reads back (OA-91), and each names its change set (OA-86).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { DiffView, ThreadView } from "@oriel/web/view";
import type { ChatMessage } from "./agent.ts";
import { json, type Script, testApp } from "./testing.ts";

const checkout = { kind: "cluster", grouping: "epic", cluster: "10001" };

const rename: Script = async () => ({
  value: null,
  writes: [["jira.setSummary", ["jira:SYN-23", "Practice: reject me"]]],
});

test("rejecting two change sets back to back, then answering: the agent reads Oriel's two lines as Oriel's, each naming its change set", async (t) => {
  const histories: ChatMessage[][] = [];
  const app = await testApp(t, {
    plan: (input) => {
      histories.push(input.history);
      return [{ run: "rename" }, { text: "I proposed a new title." }];
    },
    scripts: { rename },
  });
  const { id: workstreamId } = json<{ id: string }>(await app.post("/api/workstreams", checkout));
  const { id: threadId } = json<{ id: string }>(
    await app.post(`/api/workstreams/${workstreamId}/threads`, { text: "Rename SYN-23" }),
  );
  await app.app.settled();
  await app.post(`/api/threads/${threadId}/messages`, { text: "Try another." });
  await app.app.settled();
  const view = async () => json<ThreadView>(await app.get(`/api/threads/${threadId}`));
  const [first, second] = (await view()).changeSets.map((set) => set.id);
  assert.ok(first && second);
  for (const id of [first, second]) {
    const { hash } = json<DiffView>(await app.post(`/api/change-sets/${id}/diff`));
    assert.equal((await app.post(`/api/change-sets/${id}/reject`, { hash })).status, 200);
  }
  // The chat shows each as Oriel's line, naming its change set, and nothing
  // Oriel wrote is the agent's text.
  const entries = (await view()).entries;
  assert.deepEqual(
    entries.flatMap((e) => (e.kind === "note" ? [e.note] : [])),
    [first, second].map((changeSetId) => ({ kind: "rejected", changeSetId, via: "thread" })),
  );
  assert.deepEqual(
    entries.flatMap((e) => (e.kind === "text" ? [e.text] : [])),
    ["I proposed a new title.", "I proposed a new title."],
  );
  await app.post(`/api/threads/${threadId}/messages`, { text: "Too long." });
  await app.app.settled();
  const history = histories.at(-1) ?? [];
  // Each run says which change set its changes became.
  assert.deepEqual(
    history.flatMap((m) => (m.role === "run" ? [m.summary.split("they are change set ")[1]] : [])),
    [first, second],
  );
  // Oriel's lines are notes, last, the second just before the answer.
  assert.deepEqual(
    history.slice(-2).map((m) => (m.role === "note" ? m.note.changeSet : m.role)),
    [first, second],
  );
  assert.deepEqual(
    history.flatMap((m) => (m.role === "assistant" ? [m.text] : [])),
    ["I proposed a new title.", "I proposed a new title."],
  );
  // The answer counts as the reason for rejecting the second.
  const asked = app.app.telemetry().filter((e) => e.name === "question.asked");
  assert.deepEqual(
    asked.map((e) => e.data.rejected),
    [undefined, undefined, second],
  );
});

test("a run after the one that captured, which only read, doesn't take the change set's name", async (t) => {
  const histories: ChatMessage[][] = [];
  const look: Script = async () => ({ value: 1, writes: [] });
  const app = await testApp(t, {
    plan: (input) => {
      histories.push(input.history);
      return [{ run: "rename" }, { run: "look" }, { text: "I proposed a new title." }];
    },
    scripts: { rename, look },
  });
  const { id: workstreamId } = json<{ id: string }>(await app.post("/api/workstreams", checkout));
  const { id: threadId } = json<{ id: string }>(
    await app.post(`/api/workstreams/${workstreamId}/threads`, { text: "Rename SYN-23" }),
  );
  await app.app.settled();
  const [set] = json<ThreadView>(await app.get(`/api/threads/${threadId}`)).changeSets;
  assert.ok(set);
  await app.post(`/api/threads/${threadId}/messages`, { text: "Thanks." });
  await app.app.settled();
  const runs = (histories.at(-1) ?? []).flatMap((m) => (m.role === "run" ? [m.summary] : []));
  assert.equal(runs.length, 2);
  assert.ok(runs[0]?.endsWith(`; they are change set ${set.id}`), String(runs[0]));
  assert.ok(!runs[1]?.includes("change set"), String(runs[1]));
});
