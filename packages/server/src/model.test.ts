// Which model the server runs the agent and titles on: the one Settings
// picks among the providers found and turned on; with no pick, the key when
// there is one, else the person's Claude Code, else their Codex, else none,
// which says how to set one up.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { HarnessProblem } from "@oriel/agent";
import { models, type ModelsOptions, setupAgent } from "./model.ts";
import { defaultSettings, type Settings } from "./settings.ts";

const cli = { path: "/usr/local/bin/claude", version: "2.1.314" };
const found = async () => ({ ok: true as const, cli });
const problem: HarnessProblem = {
  kind: "missing",
  message:
    "Oriel's agent runs on Claude Code, which isn't installed here. Install Claude Code and sign in to it, then restart Oriel.",
};
const absent = async () => ({ ok: false as const, problem });
// The person's Codex, signed in, and the models it lists.
const codexCli = { path: "/usr/local/bin/codex", version: "0.166.0" };
const codexModels = [
  { id: "gpt-6.1-sol", label: "GPT-6.1-Sol", isDefault: true },
  { id: "gpt-6-luna", label: "GPT-6-Luna", isDefault: false },
];
const codexReady = async () => ({
  ok: true as const,
  cli: codexCli,
  models: codexModels,
  account: { plan: "ChatGPT Plus", email: null, personal: true },
});
const codexSignedOut = async () => ({
  ok: false as const,
  problem: {
    kind: "signed-out" as const,
    message: "Codex is installed but not signed in. Sign in to it, then restart Oriel.",
  },
});
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

test("Codex is a choice once signed in, but Claude Code stays the default while both are ready (0048)", async () => {
  const chooser = titled({ key: null, check: found, checkCodex: codexReady });
  await chooser.look(defaultSettings);
  assert.equal(chooser.choose(defaultSettings).model?.provider.id, "claude-code");
  const row = chooser.providers(defaultSettings).find((p) => p.kind === "codex");
  assert.deepEqual(
    [row?.status, row?.detail, row?.version],
    ["ready", "Signed in · version 0.166.0", "0.166.0"],
  );
  // Its models are the ones it lists, picked like any other.
  assert.deepEqual(
    chooser
      .options(defaultSettings)
      .filter((o) => o.provider === "codex")
      .map((o) => o.label),
    ["GPT-6.1-Sol · Codex", "GPT-6-Luna · Codex"],
  );
  const picked: Settings = {
    ...defaultSettings,
    model: { provider: "codex", model: "gpt-6-luna" },
  };
  const choice = chooser.choose(picked);
  assert.deepEqual([choice.model?.provider.id, choice.model?.model], ["codex", "gpt-6-luna"]);
  assert.equal(choice.model?.cli, codexCli);
  // Titles follow it, on Codex's own default.
  assert.deepEqual([choice.title?.provider.id, choice.title?.model], ["codex", "gpt-6.1-sol"]);
  assert.match(
    chooser.describe(picked),
    /GPT-6-Luna through Codex 0\.166\.0 at \/usr\/local\/bin\/codex/,
  );
  // A Claude model is no Codex model: the pick falls back.
  const wrong: Settings = {
    ...defaultSettings,
    model: { provider: "codex", model: "claude-opus-5-5" },
  };
  assert.equal(chooser.choose(wrong).model?.provider.id, "claude-code");
  // With Claude Code off, Codex alone runs threads and titles.
  const alone = chooser.choose(off(defaultSettings, "claude-code"));
  assert.deepEqual(
    [alone.model?.provider.id, alone.model?.model, alone.title?.model],
    ["codex", "gpt-6.1-sol", "gpt-6.1-sol"],
  );
});

test("with only Codex, signed out, a turn says Codex's own sentence; not installed, no row", async () => {
  const chooser = titled({ key: null, check: absent, checkCodex: codexSignedOut });
  await chooser.look(defaultSettings);
  assert.equal(chooser.choose(defaultSettings).problem, (await codexSignedOut()).problem.message);
  assert.equal(
    chooser.providers(defaultSettings).find((p) => p.kind === "codex")?.status,
    "signed-out",
  );
  // Not on this PATH: the real check finds nothing and runs nothing.
  const none = titled({ key: null, check: absent });
  await none.look(defaultSettings);
  assert.equal(
    none.providers(defaultSettings).find((p) => p.kind === "codex"),
    undefined,
  );
  assert.equal(none.choose(defaultSettings).problem, problem.message);
});

test("Codex's usage is its own plan's, asked of Codex", async () => {
  const asked: string[] = [];
  const chooser = titled({
    key: null,
    check: found,
    checkCodex: codexReady,
    plan: async (at, kind) => {
      asked.push(`${kind} ${at.path}`);
      return { windows: [] };
    },
  });
  await chooser.look(defaultSettings);
  const usage = await chooser.usage(defaultSettings);
  assert.deepEqual(
    usage.map((u) => u.provider),
    ["claude-code", "codex"],
  );
  assert.deepEqual(asked, ["claude-code /usr/local/bin/claude", "codex /usr/local/bin/codex"]);
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
  // And Codex's, for Codex.
  const codexPaths: (string | undefined)[] = [];
  const codex = titled({
    key: null,
    check: absent,
    checkCodex: async (options) => {
      codexPaths.push(options.path);
      return codexSignedOut();
    },
  });
  await codex.look({
    ...defaultSettings,
    providers: defaultSettings.providers.map((p) =>
      p.kind === "codex" ? { ...p, path: "/set/codex" } : p,
    ),
  });
  assert.deepEqual(codexPaths, ["/set/codex"]);
  // A path that finds nothing keeps Codex's row, so its path can be fixed.
  const wrong = titled({
    key: null,
    check: absent,
    checkCodex: async () => ({ ok: false, problem }),
  });
  const pathed: Settings = {
    ...defaultSettings,
    providers: defaultSettings.providers.map((p) =>
      p.kind === "codex" ? { ...p, path: "/set/codex" } : p,
    ),
  };
  await wrong.look(pathed);
  assert.equal(wrong.providers(pathed).find((p) => p.kind === "codex")?.status, "missing");
  // The CLI's own words, with Check again in place of a restart.
  assert.match(chooser.providers(set)[0]?.detail ?? "", /then check again\.$/);
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
  assert.equal(row?.detail, "It isn't signed by Anthropic, so Oriel won't run it.");
  // Trusted at the look, then changed before a title: it isn't run.
  refuse = false;
  await chooser.look(defaultSettings);
  assert.deepEqual(checked, [join(dir, "claude")]);
  refuse = true;
  const titler = chooser.titler(() => defaultSettings);
  await assert.rejects(titler("Plan it", { signal, log: quiet }), /isn't signed by Anthropic/);
});

test("on the desktop app a turn with no AI points to Settings, never to a terminal", async () => {
  const signedOut = async () => ({
    ok: false as const,
    problem: {
      kind: "signed-out" as const,
      message:
        "Claude Code is installed but not signed in. Open it in a terminal and sign in, then restart Oriel.",
    },
  });
  const desktop = models({ key: null, env, check: signedOut, desktop: true });
  await desktop.look(defaultSettings);
  const { problem: said } = desktop.choose(defaultSettings);
  assert.equal(
    said,
    "Oriel has no AI set up yet. Set up Claude Code or Codex in Settings, or add an API key there.",
  );
  assert.doesNotMatch(said, /terminal/i);
  // Under pnpm dev, the harness's own words stand.
  const dev = models({ key: null, env, check: signedOut });
  await dev.look(defaultSettings);
  assert.match(dev.choose(defaultSettings).problem, /terminal/);
});

test("Noticed's pass runs on the threads' provider: Sonnet at low effort, or Codex's own default (0052)", async () => {
  const ran: string[] = [];
  const chooser = models({
    key: "sk-ant-key",
    env,
    check: found,
    checkCodex: codexReady,
    provider: (r, _key, effort) => {
      ran.push(`${r.provider.id} ${r.model} ${effort ?? "default"}`);
      return { converse: () => ({ next: async function* () {} }) };
    },
    titler: () => async () => "a title",
  });
  await chooser.look(defaultSettings);
  assert.equal((await chooser.noticer(defaultSettings))?.model, "claude-sonnet-5-5");
  // The person picked Codex's other model for threads; the pass runs Codex's
  // default, at its own effort.
  const codex: Settings = { ...defaultSettings, model: { provider: "codex", model: "gpt-6-luna" } };
  assert.equal((await chooser.noticer(codex))?.model, "gpt-6.1-sol");
  assert.deepEqual(ran, ["api claude-sonnet-5-5 low", "codex gpt-6.1-sol default"]);
  // No model, no pass.
  const none = models({ key: null, env, check: absent, checkCodex: codexSignedOut });
  await none.look(defaultSettings);
  assert.equal(await none.noticer(defaultSettings), null);
});
