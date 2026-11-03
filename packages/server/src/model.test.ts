// Which model the server runs the agent and titles on: the one Settings
// picks among the providers found and turned on; with no pick, the key when
// there is one, else the person's Claude Code, else none, which says how to
// set one up.
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { HarnessProblem } from "@oriel/agent";
import { codexNotYet, models, type ModelsOptions, setupAgent } from "./model.ts";
import { defaultSettings, type Settings } from "./settings.ts";

const cli = { path: "/usr/local/bin/claude", version: "2.1.314" };
const found = async () => ({ ok: true as const, cli });
const problem: HarnessProblem = {
  kind: "missing",
  message:
    "Oriel's agent runs on Claude Code, which isn't installed here. Install Claude Code and sign in to it, then restart Oriel.",
};
const absent = async () => ({ ok: false as const, problem });
// No codex on this PATH.
const env = { PATH: "" };

// What each title ran on, by instance and model.
const titled = (options: Omit<ModelsOptions, "env" | "titler">) =>
  models({ env, ...options, titler: (r) => async () => `${r.provider.id} ${r.model}` });

const off = (settings: Settings, id: string): Settings => ({
  ...settings,
  providers: settings.providers.map((p) => (p.id === id ? { ...p, on: false } : p)),
});

const signal = new AbortController().signal;
const quiet = () => {};

async function turnEvents(agent: ReturnType<typeof setupAgent>) {
  const events = [];
  for await (const event of agent.turn({} as never, { signal, log: quiet })) events.push(event);
  return events;
}

test("with no pick, the key runs both, and Claude Code is looked for too, for its row", async () => {
  let looked = 0;
  const chooser = titled({
    key: "sk-ant-key",
    check: async () => {
      looked++;
      return found();
    },
  });
  await chooser.look(defaultSettings);
  assert.equal(looked, 1);
  const choice = chooser.choose(defaultSettings);
  assert.equal(choice.model?.provider.id, "api");
  assert.equal(choice.model?.model, "claude-opus-5-5");
  assert.equal(choice.title?.provider.id, "api");
  assert.equal(choice.title?.model, "claude-haiku-5-5");
});

test("without a key, a supported, signed-in Claude Code; without one, none", async () => {
  const harness = titled({ key: null, check: found });
  await harness.look(defaultSettings);
  assert.equal(harness.choose(defaultSettings).model?.cli, cli);
  const none = titled({ key: null, check: absent });
  await none.look(defaultSettings);
  const choice = none.choose(defaultSettings);
  assert.equal(choice.model, null);
  assert.equal(choice.title, null);
  assert.equal(choice.problem, problem.message);
});

test("Settings' pick wins, and a pick turned off falls back to what's on", async () => {
  const chooser = titled({ key: "k", check: found });
  await chooser.look(defaultSettings);
  const picked: Settings = {
    ...defaultSettings,
    model: { provider: "claude-code", model: "claude-sonnet-5-5" },
  };
  const choice = chooser.choose(picked);
  assert.equal(choice.model?.provider.id, "claude-code");
  assert.equal(choice.model?.model, "claude-sonnet-5-5");
  // Titles follow the default's provider, with the small model.
  assert.equal(choice.title?.provider.id, "claude-code");
  assert.equal(choice.title?.model, "claude-haiku-5-5");
  const fallback = chooser.choose(off(picked, "claude-code"));
  assert.equal(fallback.model?.provider.id, "api");
  assert.equal(fallback.model?.model, "claude-opus-5-5");
});

test("titles run on their own pick, and each title chooses again", async () => {
  let settings: Settings = {
    ...defaultSettings,
    titleModel: { provider: "claude-code", model: "claude-sonnet-5-5" },
  };
  const chooser = titled({ key: "k", check: found });
  await chooser.look(settings);
  const titler = chooser.titler(() => settings);
  assert.equal(await titler("hi", { signal, log: quiet }), "claude-code claude-sonnet-5-5");
  settings = { ...settings, titleModel: { provider: "api", model: "claude-haiku-5-5" } };
  assert.equal(await titler("hi", { signal, log: quiet }), "api claude-haiku-5-5");
  settings = off(off(settings, "api"), "claude-code");
  await assert.rejects(titler("hi", { signal, log: quiet }), /No model is on/);
});

test("with every provider off, a turn says to turn one on, at the next turn", async () => {
  let settings = defaultSettings;
  const chooser = titled({ key: null, check: found });
  await chooser.look(settings);
  const agent = chooser.agent(() => settings, {} as never);
  settings = off(settings, "claude-code");
  assert.deepEqual(await turnEvents(agent), [
    {
      kind: "error",
      message: "Every provider Oriel can use is turned off. Turn one on in Settings.",
    },
    { kind: "done", usage: { inputTokens: 0, outputTokens: 0 } },
  ]);
});

test("a turn with no model says how to set one up and names no credential", async () => {
  assert.deepEqual(await turnEvents(setupAgent(problem.message)), [
    { kind: "error", message: problem.message },
    { kind: "done", usage: { inputTokens: 0, outputTokens: 0 } },
  ]);
  assert.doesNotMatch(problem.message, /key|token|password|credential/i);
});

test("rows say what was found, which models each runs, and never the key", async () => {
  const chooser = titled({ key: "sk-ant-secret-value", check: found });
  assert.equal(chooser.providers(defaultSettings)[0]?.status, "checking");
  await chooser.look(defaultSettings);
  const rows = chooser.providers(defaultSettings);
  // Codex isn't on this PATH, so it has no row.
  assert.deepEqual(
    rows.map((row) => [row.id, row.status, row.detail, row.version, row.uses]),
    [
      [
        "claude-code",
        "ready",
        "Signed in · version 2.1.314",
        "2.1.314",
        { model: null, title: null },
      ],
      ["api", "ready", "A key is set in .env", null, { model: "Opus 5.5", title: "Haiku 5.5" }],
    ],
  );
  assert.doesNotMatch(JSON.stringify(rows), /sk-ant-secret-value/);
  assert.doesNotMatch(chooser.describe(defaultSettings), /sk-ant-secret-value/);
  assert.deepEqual(
    chooser.options(off(defaultSettings, "api")).map((o) => o.label),
    ["Opus 5.5 · Claude Code", "Sonnet 5.5 · Claude Code", "Haiku 5.5 · Claude Code"],
  );
});

test("Codex has a row once it's on the PATH, never run, which Oriel can't run on yet (0040)", async () => {
  const bin = mkdtempSync(join(tmpdir(), "oriel-codex-"));
  try {
    const codex = join(bin, process.platform === "win32" ? "codex.exe" : "codex");
    writeFileSync(codex, "");
    chmodSync(codex, 0o755);
    const chooser = models({ key: null, check: absent, env: { PATH: bin } });
    await chooser.look(defaultSettings);
    const row = chooser.providers(defaultSettings).find((p) => p.kind === "codex");
    assert.equal(row?.status, "not-yet");
    assert.equal(row?.detail, codexNotYet);
    assert.equal(chooser.options(defaultSettings).length, 0);
    // With no Claude Code and no key, a turn and the server's line say why.
    assert.equal(chooser.choose(defaultSettings).problem, codexNotYet);
    assert.match(chooser.describe(defaultSettings), /can't be limited to Oriel's one tool/);
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
});

test("a path set in Settings is the one checked, over --claude-code", async () => {
  const paths: (string | undefined)[] = [];
  const chooser = titled({
    key: null,
    claudeCodePath: "/flag/claude",
    check: async (options) => {
      paths.push(options.path);
      return absent();
    },
  });
  await chooser.look(defaultSettings);
  const set: Settings = {
    ...defaultSettings,
    providers: defaultSettings.providers.map((p) =>
      p.kind === "claude-code" ? { ...p, path: "/set/claude" } : p,
    ),
  };
  await chooser.look(set);
  assert.deepEqual(paths, ["/flag/claude", "/set/claude"]);
  // The CLI's own words, with Check again in place of a restart.
  assert.match(chooser.providers(set)[0]?.detail ?? "", /then check again\.$/);
});
