import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import type { ModelEvent, Provider } from "@oriel/agent";
import type { ConnectionView, SettingsView } from "@oriel/web/view";
import { models } from "./model.ts";
import { memorySettings } from "./settings.ts";
import { json, testApp } from "./testing.ts";

const key = "sk-ant-settings-test-value";
const cli = { path: "/usr/local/bin/claude", version: "2.1.314" };

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

// No screen names the Mac's user: paths show from `~`, and a `~/…` saved is kept as the real path.
test("Connections and Settings › Providers show paths from ~, never the home folder", async (t) => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "oriel-home-")));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, "notes"));
  writeFileSync(join(home, "notes", "plan.md"), "# Plan\n");
  const chooser = models({ key: null, env: { PATH: "" }, check: async () => ({ ok: true, cli }) });
  const settings = memorySettings();
  const app = await testApp(t, { models: chooser, settings, home, cliPaths: true, jira: false });

  const saved = await app.post("/api/settings", { provider: "claude-code", path: "~/bin/claude" });
  assert.equal(saved.status, 200);
  const shown = json<SettingsView>(await app.get("/api/settings"));
  assert.equal(shown.providers.find((p) => p.id === "claude-code")?.path, "~/bin/claude");
  const kept = settings.get().providers.find((p) => p.id === "claude-code")?.path;
  assert.equal(kept, join(home, "bin", "claude"));

  const made = await app.post("/api/connections", {
    kind: "folder",
    given: { path: join(home, "notes") },
  });
  assert.equal(made.status, 200);
  const { connections } = json<{ connections: ConnectionView[] }>(
    await app.get("/api/connections"),
  );
  const folder = connections.find((each) => each.kind === "folder");
  assert.equal(folder?.about, "~/notes");
  for (const reply of [shown, connections])
    assert.doesNotMatch(JSON.stringify(reply), new RegExp(home.replaceAll("/", "\\/")));
});
