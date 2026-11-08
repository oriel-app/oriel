// Which model the server runs the agent on, where a secret or an untrusted
// CLI could leak or run: the key never shows, a CLI the trust check refuses
// never runs, and a local server starts only by its own entry's command.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { models, type ModelsOptions } from "./model.ts";
import { defaultSettings } from "./settings.ts";

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

test("Claude Code starts a local server by its command and arguments only where they're its entry's", async () => {
  const called: unknown[] = [];
  const harness = models({
    env,
    key: null,
    check: found,
    serverCalls: (_cli, _kind, options) => {
      called.push(options.server);
      return { call: async () => ({ content: [] }), spent: () => ({}) as never, close: () => {} };
    },
  });
  await harness.look(defaultSettings);
  const local = { command: "node", args: ["/checkout/packages/sheets-mcp/src/main.ts"] };
  const server = {
    name: "sheets",
    status: "connected" as const,
    reports: "sheets-mcp",
    url: null,
    command: "node /checkout/packages/sheets-mcp/src/main.ts",
    tools: ["read_range"],
    local,
  };
  const known = (command: string) => ({
    name: "sheets-mcp",
    reports: "sheets-mcp",
    at: { command },
    reads: ["read_range"],
    writes: [],
    instructions: "",
  });
  await harness.serverCalls(
    defaultSettings,
    server,
    ["read_range"],
    quiet,
    known("node /checkout/packages/sheets-mcp/src/main.ts"),
  );
  // Another command, or none, is a server Claude Code can't load alone.
  await harness.serverCalls(
    defaultSettings,
    server,
    ["read_range"],
    quiet,
    known("node /elsewhere/main.ts"),
  );
  await harness.serverCalls(defaultSettings, server, ["read_range"], quiet);
  assert.deepEqual(called, [{ name: "sheets", local }, { name: "sheets" }, { name: "sheets" }]);
});
