// Settings through the server (OA-181): what it shows of each provider, never
// a key; a change applies at the next turn, in a thread and the window chat,
// and at the next title; a theme picked is counted; nothing it can't check
// is kept.
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
  const view = json<SettingsView>(reply);
  assert.deepEqual(
    view.providers.map((p) => [p.id, p.status, p.detail]),
    [
      ["claude-code", "ready", "Signed in · version 2.1.314"],
      ["api", "ready", "A key is set in .env"],
    ],
  );
  assert.deepEqual(view.model, { provider: "api", model: "claude-opus-5-5" });
  assert.deepEqual(view.titleModel, { provider: "api", model: "claude-haiku-5-5" });
  assert.equal(view.models.length, 6);
  assert.deepEqual(view.themes, ["graphite", "broadsheet"]);
});

test("a pick applies at the next turn, in a thread and the window chat, and at the next title", async (t) => {
  const app = await settingsApp(t);
  const { id: workstreamId } = json<{ id: string }>(
    await app.post("/api/workstreams", { kind: "cluster", grouping: "epic", cluster: "10001" }),
  );
  const { id } = json<{ id: string }>(
    await app.post(`/api/workstreams/${workstreamId}/threads`, { text: "One" }),
  );
  await app.app.settled();
  let view = json<ThreadView>(await app.get(`/api/threads/${id}`));
  assert.equal(lastReply(view), "api claude-opus-5-5");
  assert.equal(view.title, "Titled by api claude-haiku-5-5");

  const picked = await app.post("/api/settings", {
    model: { provider: "claude-code", model: "claude-sonnet-5-5" },
  });
  assert.equal(picked.status, 200);
  await app.post(`/api/threads/${id}/messages`, { text: "Two" });
  await app.app.settled();
  view = json<ThreadView>(await app.get(`/api/threads/${id}`));
  assert.equal(lastReply(view), "claude-code claude-sonnet-5-5");

  await app.post("/api/settings", { titleModel: { provider: "api", model: "claude-sonnet-5-5" } });
  await app.post("/api/window-chat/messages", { text: "What moved?" });
  await app.app.settled();
  const chat = json<{ thread: string | null }>(await app.get("/api/window-chat")).thread;
  assert.ok(chat);
  const chatView = json<ThreadView>(await app.get(`/api/threads/${chat}`));
  assert.equal(lastReply(chatView), "claude-code claude-sonnet-5-5");
  assert.equal(chatView.title, "Titled by api claude-sonnet-5-5");

  // Every provider off: the next turn says so.
  await app.post("/api/settings", { provider: "api", on: false });
  await app.post("/api/settings", { provider: "claude-code", on: false });
  await app.post(`/api/threads/${id}/messages`, { text: "Three" });
  await app.app.settled();
  view = json<ThreadView>(await app.get(`/api/threads/${id}`));
  assert.match(
    JSON.stringify(view.entries.findLast((e) => e.kind === "error")),
    /Every provider Oriel can use is turned off\. Turn one on in Settings\./,
  );
});

test("a change Oriel can't check is refused, and a theme picked is counted once", async (t) => {
  const app = await settingsApp(t);
  assert.equal((await app.post("/api/settings", { theme: "neon" })).status, 409);
  assert.equal((await app.post("/api/settings", { textSize: "huge" })).status, 400);
  // Under `pnpm dev`, no path is taken from the page at all.
  const path = await app.post("/api/settings", {
    provider: "claude-code",
    path: "/opt/homebrew/bin/claude",
  });
  assert.equal(path.status, 409);
  assert.match(json<{ error: string }>(path).error, /--claude-code/);
  assert.equal(
    (await app.post("/api/settings", { model: { provider: "codex", model: "claude-opus-5-5" } }))
      .status,
    409,
  );
  const themed = json<SettingsView>(await app.post("/api/settings", { theme: "broadsheet" }));
  assert.equal(themed.theme, "broadsheet");
  await app.post("/api/settings", { theme: "broadsheet" });
  assert.deepEqual(
    app.app
      .telemetry()
      .filter((e) => e.name === "theme.picked")
      .map((e) => e.data.theme),
    ["broadsheet"],
  );
  assert.deepEqual(app.app.settings.page(), { theme: "broadsheet", textSize: "default" });
  // Check again answers with the view.
  assert.equal(json<SettingsView>(await app.post("/api/settings/look", {})).providers.length, 2);
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
  assert.match(row()?.detail ?? "", /Paste one from Anthropic's console/);

  const refused = await app.post("/api/settings/key", { key });
  assert.equal(refused.status, 409);
  assert.match(json<{ error: string }>(refused).error, /doesn't accept that key/);
  assert.doesNotMatch(String(refused.body), new RegExp(key));
  assert.equal(kept.size, 0);

  answer = "ok";
  const saved = await app.post("/api/settings/key", { key });
  assert.equal(saved.status, 200);
  assert.doesNotMatch(String(saved.body), new RegExp(key));
  view = json<SettingsView>(saved);
  assert.equal(row()?.status, "ready");
  assert.equal(row()?.detail, "A key is kept in the OS secret store");
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

test("under pnpm dev, the page can't set a key: it's .env's", async (t) => {
  const app = await settingsApp(t);
  assert.equal(json<SettingsView>(await app.get("/api/settings")).apiKeys, false);
  const refused = await app.post("/api/settings/key", { key: "sk-ant-another" });
  assert.equal(refused.status, 409);
  assert.match(json<{ error: string }>(refused).error, /ANTHROPIC_API_KEY in \.env/);
  assert.equal((await app.post("/api/settings/key", { key: 12 })).status, 400);
});
