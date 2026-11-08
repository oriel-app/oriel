// Which model the server runs the agent on, where a secret or an untrusted
// CLI could leak or run: the key never shows, a CLI the trust check refuses
// never runs, and a local server starts only by its own entry's command.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { models, type ModelsOptions } from "./model.ts";
import { defaultSettings, settingsFile } from "./settings.ts";

const cli = { path: "/usr/local/bin/claude", version: "2.1.314" };
const found = async () => ({ ok: true as const, cli });
// No codex on this PATH.
const env = { PATH: "" };

// What each title ran on, by instance and model.
const titled = (options: Omit<ModelsOptions, "env" | "titler">) =>
  models({ env, ...options, titler: (r) => async () => `${r.provider.id} ${r.model}` });

const signal = new AbortController().signal;
const quiet = () => {};

test("the providers' rows and the model's description never carry the key", async () => {
  const chooser = titled({ key: "sk-ant-secret-value", check: found });
  await chooser.look(defaultSettings);
  const rows = chooser.providers(defaultSettings);
  assert.ok(rows.some((row) => row.id === "api" && row.status === "ready"));
  assert.doesNotMatch(JSON.stringify(rows), /sk-ant-secret-value/);
  assert.doesNotMatch(JSON.stringify(chooser.options(defaultSettings)), /sk-ant-secret-value/);
  assert.doesNotMatch(chooser.describe(defaultSettings), /sk-ant-secret-value/);
});

// QA, 2026-11-08 (after #237): with `.env`'s key and an older settings file
// listing the key first, the key ran threads, and it has no MCP servers.
test("with no key asked for, an older file's API key runs nothing, and Claude Code runs", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "oriel-order-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "settings.json");
  writeFileSync(
    path,
    JSON.stringify({
      providers: [
        { id: "api", kind: "api", name: "API key", on: true },
        { id: "claude-code", kind: "claude-code", name: "Claude Code", on: true },
      ],
      model: { provider: "api", model: "claude-opus-5-5" },
    }),
  );
  const settings = settingsFile(path, quiet).get();
  assert.ok(settings.providers.every((p) => p.kind !== "api"));
  const chooser = titled({ key: null, check: found });
  await chooser.look(settings);
  assert.equal(chooser.choose(settings).model?.provider.kind, "claude-code");
  assert.ok(chooser.providers(settings).every((row) => row.kind !== "api"));
});

test("a CLI the trust check refuses is never run: not by a look, a turn or a title (0038)", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "oriel-trust-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "claude"), "", { mode: 0o755 });
  const checked: string[] = [];
  let refuse = true;
  const chooser = models({
    key: null,
    env: { PATH: dir },
    check: async (options) => {
      checked.push(options.path ?? "");
      return { ok: true, cli: { path: options.path ?? "", version: "2.1.314" } };
    },
    trust: async () => (refuse ? "It isn't signed by Anthropic, so Oriel won't run it." : null),
    provider: () => {
      throw new Error("no provider in this test");
    },
    titler: () => async () => "a title",
  });
  await chooser.look(defaultSettings);
  assert.equal(chooser.found("claude-code").status, "untrusted");
  assert.deepEqual(checked, []);
  const row = chooser.providers(defaultSettings).find((p) => p.kind === "claude-code");
  assert.equal(row?.status, "untrusted");
  // Trusted at the look, then changed before a title: it isn't run.
  refuse = false;
  await chooser.look(defaultSettings);
  assert.deepEqual(checked, [join(dir, "claude")]);
  refuse = true;
  const titler = chooser.titler(() => defaultSettings);
  await assert.rejects(titler("Plan it", { signal, log: quiet }));
});

test("a local server is called by its own entry's command and arguments, whatever Oriel knows it by", async () => {
  const called: unknown[] = [];
  const harness = models({
    env,
    key: null,
    check: found,
    serverCalls: (_cli, _kind, options) => {
      called.push(options.server);
      return { call: async () => ({ content: [] }), close: () => {} };
    },
  });
  await harness.look(defaultSettings);
  const local = { command: "node", args: ["/elsewhere/sheets-mcp/main.ts"] };
  const server = {
    name: "sheets",
    status: "connected" as const,
    reports: "sheets-mcp",
    url: null,
    command: "node /elsewhere/sheets-mcp/main.ts",
    tools: ["read_range"],
    local,
  };
  await harness.serverCalls(defaultSettings, server, ["read_range"], quiet);
  // Before decision 0060, one at a command other than its known entry's
  // couldn't load on Claude Code; the tool host checks it where the person's
  // agent reported it.
  assert.deepEqual(called, [{ name: "sheets", local }]);
});
