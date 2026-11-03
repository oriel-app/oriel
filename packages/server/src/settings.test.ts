// Settings: kept in one file in the data folder, read field by field, and
// changed one setting at a time, each checked.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { models } from "./model.ts";
import {
  changed,
  defaultSettings,
  memorySettings,
  settingsChange,
  settingsFile,
  SettingsRefused,
  settingsService,
} from "./settings.ts";

const quiet = () => {};

function inFolder(run: (path: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "oriel-settings-"));
  try {
    run(join(dir, "settings.json"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("with no file, the defaults; a change is written, owner-only, and read back", () => {
  inFolder((path) => {
    const store = settingsFile(path, quiet);
    assert.deepEqual(store.get(), defaultSettings);
    store.set({ ...defaultSettings, textSize: "large", send: "mod-enter" });
    if (process.platform !== "win32") assert.equal(statSync(path).mode & 0o777, 0o600);
    const again = settingsFile(path, quiet).get();
    assert.equal(again.textSize, "large");
    assert.equal(again.send, "mod-enter");
  });
});

test("a field the file can't read falls back alone, and a new kind shows up, on", () => {
  inFolder((path) => {
    writeFileSync(
      path,
      JSON.stringify({
        textSize: "huge",
        send: "mod-enter",
        theme: '"><script>',
        model: { provider: "api", model: "claude-sonnet-5-5" },
        providers: [
          { id: "claude-code", kind: "claude-code", name: "Claude Code", on: false },
          { id: "work", kind: "claude-code", name: "Work account", on: true, path: "/opt/claude" },
          { id: "odd", kind: "claude-code", name: "Odd", on: true, path: "relative/claude" },
          { id: "claude-code", kind: "api", name: "Again", on: true },
        ],
      }),
    );
    const read = settingsFile(path, quiet).get();
    assert.equal(read.textSize, "default");
    assert.equal(read.send, "mod-enter");
    assert.equal(read.theme, "graphite");
    assert.deepEqual(read.model, { provider: "api", model: "claude-sonnet-5-5" });
    assert.deepEqual(read.providers, [
      { id: "claude-code", kind: "claude-code", name: "Claude Code", on: false },
      // A second account of a kind is its own instance, with its own path.
      { id: "work", kind: "claude-code", name: "Work account", on: true, path: "/opt/claude" },
      // A path that isn't a full path to the CLI is dropped.
      { id: "odd", kind: "claude-code", name: "Odd", on: true },
      { id: "codex", kind: "codex", name: "Codex", on: true },
      { id: "api", kind: "api", name: "API key", on: true },
    ]);
  });
});

test("a file that isn't JSON leaves the defaults standing", () => {
  inFolder((path) => {
    writeFileSync(path, "{ not json");
    assert.deepEqual(settingsFile(path, quiet).get(), defaultSettings);
  });
});

test("a change is one setting, checked", () => {
  const themes = ["graphite", "broadsheet"];
  assert.equal(changed(defaultSettings, { theme: "broadsheet" }, themes).theme, "broadsheet");
  assert.throws(() => changed(defaultSettings, { theme: "neon" }, themes), SettingsRefused);
  assert.throws(
    () => changed(defaultSettings, { provider: "nobody", on: false }, themes),
    SettingsRefused,
  );
  const off = changed(defaultSettings, { provider: "codex", on: false }, themes);
  assert.equal(off.providers.find((p) => p.id === "codex")?.on, false);
  // A path is a full path to the CLI the instance is, and nothing else.
  for (const path of ["claude", "/bin/sh", "/tmp/claude/../sh", "/usr/bin/claude\0x"])
    assert.throws(
      () => changed(defaultSettings, { provider: "claude-code", path }, themes),
      SettingsRefused,
      path,
    );
  // Codex's path names the codex program (decision 0048); the key takes none.
  assert.equal(
    changed(defaultSettings, { provider: "codex", path: "/usr/bin/codex" }, themes).providers[1]
      ?.path,
    "/usr/bin/codex",
  );
  for (const [provider, path] of [
    ["codex", "/usr/bin/claude"],
    ["api", "/usr/bin/codex"],
  ] as const)
    assert.throws(() => changed(defaultSettings, { provider, path }, themes), SettingsRefused);
  const set = changed(
    defaultSettings,
    { provider: "claude-code", path: "/opt/homebrew/bin/claude" },
    themes,
  );
  assert.equal(set.providers[0]?.path, "/opt/homebrew/bin/claude");
  const unset = changed(set, { provider: "claude-code", path: null }, themes);
  assert.equal("path" in (unset.providers[0] ?? {}), false);
  assert.equal(settingsChange({ textSize: "huge" }).ok, false);
  assert.equal(settingsChange({ send: "mod-enter" }).ok, true);
});

test("a model is picked only from a provider found and on; a theme picked is told once", async () => {
  const store = memorySettings();
  const chooser = models({
    key: null,
    env: { PATH: "" },
    check: async () => ({ ok: true, cli: { path: "/usr/bin/claude", version: "2.1.314" } }),
  });
  await chooser.look(store.get());
  const picked: string[] = [];
  const service = settingsService({
    store,
    models: chooser,
    themes: ["graphite", "broadsheet"],
    cliPaths: false,
    picked: (theme) => picked.push(theme),
  });
  await assert.rejects(
    service.change({ model: { provider: "api", model: "claude-opus-5-5" } }),
    /isn't connected and on/,
  );
  const view = await service.change({
    model: { provider: "claude-code", model: "claude-sonnet-5-5" },
  });
  assert.deepEqual(view.model, { provider: "claude-code", model: "claude-sonnet-5-5" });
  assert.deepEqual(view.titleModel, { provider: "claude-code", model: "claude-haiku-5-5" });
  await service.change({ theme: "broadsheet" });
  await service.change({ theme: "broadsheet" });
  assert.deepEqual(picked, ["broadsheet"]);
  assert.deepEqual(service.page(), { theme: "broadsheet", textSize: "default" });
  // A theme window.css no longer has is the default's.
  const gone = settingsService({
    store,
    models: null,
    themes: ["graphite"],
    cliPaths: false,
    picked: quiet,
  });
  assert.equal(gone.page().theme, "graphite");
  assert.equal(gone.view().scripted, true);
  assert.deepEqual(gone.view().providers, []);
});

test("a CLI's path is taken from the page only where Settings allows it, behind the desktop app's secret", async () => {
  const looked: (string | undefined)[] = [];
  const chooser = models({
    key: null,
    env: { PATH: "" },
    check: async (options) => {
      looked.push(options.path);
      return { ok: true, cli: { path: options.path ?? "/usr/bin/claude", version: "2.1.314" } };
    },
  });
  const service = (cliPaths: boolean, store = memorySettings()) =>
    settingsService({ store, models: chooser, themes: ["graphite"], cliPaths, picked: quiet });
  const dev = service(false);
  await assert.rejects(
    dev.change({ provider: "claude-code", path: "/opt/homebrew/bin/claude" }),
    /--claude-code/,
  );
  assert.equal(dev.view().cliPaths, false);
  assert.deepEqual(looked, []);
  const desktop = service(true);
  const view = await desktop.change({ provider: "claude-code", path: "/opt/homebrew/bin/claude" });
  assert.equal(view.providers[0]?.path, "/opt/homebrew/bin/claude");
  assert.deepEqual(looked.at(-1), "/opt/homebrew/bin/claude");
});

test("notifications are on by default, kept when turned off, and anything else reads as on", () => {
  inFolder((path) => {
    assert.equal(settingsFile(path, quiet).get().notify, true);
    settingsFile(path, quiet).set({ ...defaultSettings, notify: false });
    assert.equal(settingsFile(path, quiet).get().notify, false);
    writeFileSync(path, JSON.stringify({ notify: "no" }));
    assert.equal(settingsFile(path, quiet).get().notify, true);
  });
});

test("asking before quitting is on by default, kept when turned off, and anything else reads as on", () => {
  inFolder((path) => {
    assert.equal(settingsFile(path, quiet).get().askBeforeQuitting, true);
    settingsFile(path, quiet).set({ ...defaultSettings, askBeforeQuitting: false });
    assert.equal(settingsFile(path, quiet).get().askBeforeQuitting, false);
    writeFileSync(path, JSON.stringify({ askBeforeQuitting: 0 }));
    assert.equal(settingsFile(path, quiet).get().askBeforeQuitting, true);
  });
  assert.deepEqual(changed(defaultSettings, { askBeforeQuitting: false }, []), {
    ...defaultSettings,
    askBeforeQuitting: false,
  });
});

test("times are relative by default, absolute once picked, and anything else reads as relative", () => {
  inFolder((path) => {
    assert.equal(settingsFile(path, quiet).get().timeFormat, "relative");
    settingsFile(path, quiet).set(changed(defaultSettings, { timeFormat: "absolute" }, []));
    assert.equal(settingsFile(path, quiet).get().timeFormat, "absolute");
    writeFileSync(path, JSON.stringify({ timeFormat: "sundial" }));
    assert.equal(settingsFile(path, quiet).get().timeFormat, "relative");
  });
  assert.equal(settingsChange({ timeFormat: "sundial" }).ok, false);
});
