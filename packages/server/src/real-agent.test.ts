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
