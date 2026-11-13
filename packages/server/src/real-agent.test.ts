import assert from "node:assert/strict";
import { test } from "node:test";
import { agent, type ModelEvent, type Provider, runToolName, type Usage } from "@oriel/agent";
import type { ThreadView } from "@oriel/web/view";
import { json, type Script, testApp } from "./testing.ts";

const usage: Usage = { inputTokens: 40, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 };

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
  const { id: workstreamId } = json<{ id: string }>(
    await app.post("/api/workstreams", { kind: "cluster", grouping: "epic", cluster: "10001" }),
  );
  const { id } = json<{ id: string }>(
    await app.post(`/api/workstreams/${workstreamId}/threads`, { text: "One" }),
  );
  await app.app.settled();
  return id;
};

test("a thread whose spend leaves less than a useful response: the agent stops the next turn, then the server holds it", async (t) => {
  // The server doesn't work out that too little is left: the agent does, and ends the next turn on its cap.
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
  const after = json<ThreadView>(await app.get(`/api/threads/${id}`));
  assert.equal(after.entries.at(-1)?.kind, "limit");
  assert.equal(after.entries.filter((e) => e.kind === "user").length, 2);
  assert.equal((await app.post(`/api/threads/${id}/messages`, { text: "Four" })).status, 409);
  assert.equal(
    json<ThreadView>(await app.get(`/api/threads/${id}`)).entries.length,
    after.entries.length,
  );
});

test("history() reads past the region with no item's content, and refuses an ID it can't name", async (t) => {
  const charted: Script = async (bindings) => {
    const { value } = await bindings.read("history", []);
    // What `of` names is the agent's text: an ID of a kind no source
    // declares, or of nothing the index has, is refused.
    const refused: string[] = [];
    for (const named of ["nosuch:ORL-1", "jira:SYN-999", "not an id"])
      await bindings.read("history", [named]).catch((error: Error) => refused.push(error.message));
    return { value: { value, refused } };
  };
  const app = await testApp(t, {
    scripts: { list: charted },
    agent: (deps) => agent({ ...deps, provider: provider("list") }),
  });
  const id = await thread(app);
  const view = json<ThreadView>(await app.get(`/api/threads/${id}`));
  const finished = view.entries.find((e) => e.kind === "run.finished");
  assert.ok(finished?.kind === "run.finished");
  const returned = JSON.parse(finished.run.returned ?? "null") as {
    value: { items: Record<string, unknown>[] };
    refused: string[];
  };
  // Every item, the region's and the rest, by ID and facets, never a title.
  assert.ok(returned.value.items.length > 10);
  assert.ok(returned.value.items.every((item) => !("title" in item)));
  assert.equal(returned.refused.length, 3);
});
