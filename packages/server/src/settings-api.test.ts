// Settings through the server (OA-181): never a key in a reply, and nothing
// another site can start.
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import type { ModelEvent, Provider } from "@oriel/agent";
import type { SettingsView } from "@oriel/web/view";
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

test("Settings shows each provider and what runs, and never the key", async (t) => {
  const app = await settingsApp(t);
  const reply = await app.get("/api/settings");
  assert.equal(reply.status, 200);
  assert.doesNotMatch(String(reply.body), new RegExp(key));
  assert.equal(json<SettingsView>(reply).providers.find((p) => p.id === "api")?.status, "ready");
});

test("Claude Code's usage is read only by a POST, so another site can't start the CLI", async (t) => {
  const app = await settingsApp(t);
  assert.notEqual((await app.get("/api/settings/usage")).status, 200);
  assert.equal((await app.post("/api/settings/usage")).status, 200);
});
