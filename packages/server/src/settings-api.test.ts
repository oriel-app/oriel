// Settings through the server (OA-181): never a key in a reply, a key kept
// and removed in the secret store, and nothing another site can start.
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import type { KeyCheck, ModelEvent, Provider } from "@oriel/agent";
import type { SettingsView, ThreadView } from "@oriel/web/view";
import { keyStore } from "./api-key.ts";
import { models } from "./model.ts";
import { memorySettings } from "./settings.ts";
import { json, testApp } from "./testing.ts";

const key = "sk-ant-settings-test-value";
const cli = { path: "/usr/local/bin/claude", version: "2.1.314" };

// Each reply and each title names the instance and model that ran it.
const naming = (said: string): Provider => ({
  converse() {
    return {
      async *next(): AsyncGenerator<ModelEvent> {
        yield { kind: "text", text: said };
        yield {
          kind: "end",
          stop: "done",
          detail: null,
          model: "m",
          usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
        };
      },
    };
  },
});

async function settingsApp(t: TestContext) {
  const chooser = models({
    key,
    env: { PATH: "" },
    check: async () => ({ ok: true, cli }),
    provider: (r) => naming(`${r.provider.id} ${r.model}`),
    titler: (r) => async () => `Titled by ${r.provider.id} ${r.model}`,
    plan: async () => ({
      windows: [{ kind: "week", usedPercent: 56, resetsAt: "2026-11-08T01:00:00.000Z" }],
    }),
  });
  const settings = memorySettings();
  await chooser.look(settings.get());
  return testApp(t, { models: chooser, settings });
}

const lastReply = (view: ThreadView) => {
  const said = view.entries.findLast((e) => e.kind === "text");
  return said && "text" in said ? said.text : null;
};

test("Settings shows each provider and what runs, and never the key", async (t) => {
  const app = await settingsApp(t);
  const reply = await app.get("/api/settings");
  assert.equal(reply.status, 200);
  assert.doesNotMatch(String(reply.body), new RegExp(key));
  assert.equal(json<SettingsView>(reply).providers.find((p) => p.id === "api")?.status, "ready");
});

// As the desktop app has it: the key in the OS secret store, here a map,
// which Settings sets and removes.
async function desktopApp(t: TestContext, check: (key: string) => Promise<KeyCheck>) {
  const kept = new Map<string, string>();
  const store = keyStore(
    {
      get: async (name) => kept.get(name) ?? null,
      set: async (name, secret) => void kept.set(name, secret),
      delete: async (name) => void kept.delete(name),
    },
    () => {},
  );
  const chooser = models({
    key: null,
    kept: store,
    env: { PATH: "" },
    check: async () => ({ ok: false, problem: { kind: "missing", message: "No Claude Code." } }),
    provider: (r) => naming(`${r.provider.id} ${r.model}`),
    titler: (r) => async () => `Titled by ${r.provider.id} ${r.model}`,
    plan: async () => ({
      windows: [{ kind: "week", usedPercent: 56, resetsAt: "2026-11-08T01:00:00.000Z" }],
    }),
  });
  const settings = memorySettings();
  await chooser.look(settings.get());
  const app = await testApp(t, { models: chooser, settings, keys: { store, check } });
  return { app, kept };
}

test("on the desktop app, a key Anthropic takes is kept in the secret store and runs the next turn", async (t) => {
  const checked: string[] = [];
  let answer: KeyCheck = "rejected";
  const { app, kept } = await desktopApp(t, async (typed) => {
    checked.push(typed);
    return answer;
  });
  let view = json<SettingsView>(await app.get("/api/settings"));
  assert.equal(view.apiKeys, true);
  const row = () => view.providers.find((p) => p.kind === "api");
  assert.equal(row()?.status, "no-key");

  const refused = await app.post("/api/settings/key", { key });
  assert.equal(refused.status, 409);
  assert.doesNotMatch(String(refused.body), new RegExp(key));
  assert.equal(kept.size, 0);

  answer = "ok";
  const saved = await app.post("/api/settings/key", { key });
  assert.equal(saved.status, 200);
  assert.doesNotMatch(String(saved.body), new RegExp(key));
  view = json<SettingsView>(saved);
  assert.equal(row()?.status, "ready");
  assert.deepEqual(view.model, { provider: "api", model: "claude-opus-5-5" });
  assert.deepEqual([...kept], [["anthropic-key", key]]);
  assert.deepEqual(checked, [key, key]);
  assert.doesNotMatch(String((await app.get("/api/settings")).body), new RegExp(key));

  const { id: workstreamId } = json<{ id: string }>(
    await app.post("/api/workstreams", { kind: "cluster", grouping: "epic", cluster: "10001" }),
  );
  const { id } = json<{ id: string }>(
    await app.post(`/api/workstreams/${workstreamId}/threads`, { text: "One" }),
  );
  await app.app.settled();
  assert.equal(
    lastReply(json<ThreadView>(await app.get(`/api/threads/${id}`))),
    "api claude-opus-5-5",
  );

  view = json<SettingsView>(await app.post("/api/settings/key", { key: null }));
  assert.equal(row()?.status, "no-key");
  assert.equal(view.model, null);
  assert.equal(kept.size, 0);
});

test("Claude Code's usage is read only by a POST, so another site can't start the CLI", async (t) => {
  const app = await settingsApp(t);
  assert.notEqual((await app.get("/api/settings/usage")).status, 200);
  assert.equal((await app.post("/api/settings/usage")).status, 200);
});
