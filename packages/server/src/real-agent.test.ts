// @oriel/agent's loop, wired as main.ts wires it, over a provider that
// answers from a script instead of a model: one run, then a reply.
import assert from "node:assert/strict";
import { test } from "node:test";
import { agent, type ModelEvent, type Provider, runToolName, type Usage } from "@oriel/agent";
import type { ThreadView } from "@oriel/web/view";
import { json, type Script, testApp } from "./testing.ts";

const usage: Usage = { inputTokens: 40, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 };

// The first response asks for a run of `script`; the next one answers.
function provider(script: string): Provider {
  return {
    converse() {
      let responses = 0;
      return {
        async *next(): AsyncGenerator<ModelEvent> {
          responses += 1;
          if (responses === 1) {
            yield { kind: "call", call: { id: "call-1", name: runToolName, input: { script } } };
            yield { kind: "end", stop: "calls", detail: null, model: "scripted-model", usage };
            return;
          }
          yield { kind: "text", text: "Every item is here." };
          yield { kind: "end", stop: "done", detail: null, model: "scripted-model", usage };
        },
      };
    },
  };
}

const spend = (inputTokens: number, outputTokens: number): Usage => ({
  inputTokens,
  outputTokens,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

// Answers each response with `responses`, in order, the same each turn.
function answering(responses: ModelEvent[][]): Provider {
  return {
    converse() {
      let next = 0;
      return {
        async *next(): AsyncGenerator<ModelEvent> {
          yield* responses[next] ?? [];
          next += 1;
        },
      };
    },
  };
}

const thread = async (app: Awaited<ReturnType<typeof testApp>>) => {
  const { id: groupId } = json<{ id: string }>(
    await app.post("/api/groups", { kind: "cluster", grouping: "epic", cluster: "10001" }),
  );
  const { id } = json<{ id: string }>(
    await app.post(`/api/groups/${groupId}/threads`, { text: "One" }),
  );
  await app.app.settled();
  return id;
};

test("a thread whose spend leaves less than a useful response: the agent stops the next turn, then the server holds it", async (t) => {
  // 10,000 tokens a thread; the first turn spends 6,000, which leaves the
  // agent too little for a useful response. The server doesn't work that out:
  // the agent does, and ends the next turn on its cap.
  const reply: ModelEvent[] = [
    { kind: "text", text: "Done." },
    { kind: "end", stop: "done", detail: null, model: "m", usage: spend(3000, 3000) },
  ];
  const app = await testApp(t, {
    agent: (deps) => agent({ ...deps, provider: answering([reply]) }),
    limits: { maxTokensPerThread: 10_000 },
  });
  const id = await thread(app);
  assert.equal((await app.post(`/api/threads/${id}/messages`, { text: "Two" })).status, 202);
  await app.app.settled();
  const stopped = json<ThreadView>(await app.get(`/api/threads/${id}`));
  assert.deepEqual(
    stopped.entries.slice(-3).map((e) => e.kind),
    ["user", "limit", "done"],
  );
  const refused = await app.post(`/api/threads/${id}/messages`, { text: "Three" });
  assert.equal(refused.status, 409);
  const notice = /used its 10,000 tokens\. Start a new thread on this group/;
  assert.match(json<{ error: string }>(refused).error, notice);
  const after = json<ThreadView>(await app.get(`/api/threads/${id}`));
  const last = after.entries.at(-1);
  assert.ok(last?.kind === "limit");
  assert.match(last.reason, notice);
  assert.equal(after.entries.filter((e) => e.kind === "user").length, 2);
  // Once is enough.
  assert.equal((await app.post(`/api/threads/${id}/messages`, { text: "Four" })).status, 409);
  assert.equal(
    json<ThreadView>(await app.get(`/api/threads/${id}`)).entries.length,
    after.entries.length,
  );
});

test("a turn the agent ended on its token cap ends the thread's questions", async (t) => {
  // The first response spends 5,000 and asks for a run. The next would send
  // those 5,000 again, which leaves the agent too little of its 12,000 for a
  // useful response, so it stops on its cap.
  const ask: ModelEvent[] = [
    { kind: "call", call: { id: "c1", name: runToolName, input: { script: "list" } } },
    { kind: "end", stop: "calls", detail: null, model: "m", usage: spend(2500, 2500) },
  ];
  const listed: Script = async (bindings) => ({
    value: (await bindings.read("items.list", [])).value,
  });
  const app = await testApp(t, {
    scripts: { list: listed },
    agent: (deps) => agent({ ...deps, provider: answering([ask]) }),
    limits: { maxTokensPerThread: 12_000 },
  });
  const id = await thread(app);
  const first = json<ThreadView>(await app.get(`/api/threads/${id}`));
  assert.deepEqual(
    first.entries.map((e) => e.kind),
    ["user", "limit", "done"],
  );
  // 5,000 of 12,000 spent: what's spent alone wouldn't stop the next turn,
  // but the turn ended on the agent's cap, so the server holds it too.
  const refused = await app.post(`/api/threads/${id}/messages`, { text: "Two" });
  assert.equal(refused.status, 409);
  assert.match(json<{ error: string }>(refused).error, /Start a new thread on this group/);
  const after = json<ThreadView>(await app.get(`/api/threads/${id}`));
  assert.deepEqual(
    after.entries.slice(-2).map((e) => e.kind),
    ["done", "limit"],
  );
  assert.equal((await app.post(`/api/threads/${id}/messages`, { text: "Three" })).status, 409);
  assert.equal(
    json<ThreadView>(await app.get(`/api/threads/${id}`)).entries.length,
    after.entries.length,
  );
});

test("the model-backed agent runs a turn through the server's deps", async (t) => {
  const listed: Script = async (bindings) => ({
    value: (await bindings.read("items.list", [])).value,
  });
  const app = await testApp(t, {
    scripts: { list: listed },
    agent: (deps) => agent({ ...deps, provider: provider("list") }),
  });
  const { id: groupId } = json<{ id: string }>(
    await app.post("/api/groups", { kind: "cluster", grouping: "epic", cluster: "10001" }),
  );
  const { id } = json<{ id: string }>(
    await app.post(`/api/groups/${groupId}/threads`, { text: "What's here?" }),
  );
  await app.app.settled();
  const view = json<ThreadView>(await app.get(`/api/threads/${id}`));
  assert.deepEqual(
    view.entries.map((e) => e.kind),
    ["user", "run.started", "run.finished", "text", "done"],
  );
  const runId = view.entries.find((e) => e.kind === "run.started");
  assert.ok(runId?.kind === "run.started");
  // The loop binds the run into the log it gives the sandbox.
  const reads = app.logged.filter((line) => line.message === "sandbox.read");
  assert.equal(reads.length, 1);
  assert.deepEqual([reads[0]?.fields.thread_id, reads[0]?.fields.run_id], [id, runId.runId]);
  // Its done carries both responses' usage, which the thread's cap counts.
  const done = view.entries.at(-1);
  assert.equal(done?.kind, "done");
});
