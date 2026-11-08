// Settings: kept in one file in the data folder, read field by field, and
// changed one setting at a time, each checked.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { models } from "./model.ts";
import {
  changed,
  defaultSettings,
  memorySettings,
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

test("a theme or a CLI path the file holds that isn't one falls back, field by field", () => {
  inFolder((path) => {
    writeFileSync(
      path,
      JSON.stringify({
        theme: '"><script>',
        providers: [
          { id: "work", kind: "claude-code", name: "Work account", on: true, path: "/opt/claude" },
          { id: "odd", kind: "claude-code", name: "Odd", on: true, path: "relative/claude" },
        ],
      }),
    );
    const read = settingsFile(path, quiet).get();
    assert.equal(read.theme, defaultSettings.theme);
    const paths = Object.fromEntries(read.providers.map((p) => [p.id, p.path]));
    assert.equal(paths["work"], "/opt/claude");
    assert.equal(paths["odd"], undefined);
  });
});

test("a CLI path from the page is a full path to the CLI the instance is, and nothing else", () => {
  for (const path of ["claude", "/bin/sh", "/tmp/claude/../sh", "/usr/bin/claude\0x"])
    assert.throws(
      () => changed(defaultSettings, { provider: "claude-code", path }, []),
      SettingsRefused,
      path,
    );
  for (const [provider, path] of [
    ["codex", "/usr/bin/claude"],
    ["api", "/usr/bin/codex"],
  ] as const)
    assert.throws(() => changed(defaultSettings, { provider, path }, []), SettingsRefused);
  const set = changed(
    defaultSettings,
    { provider: "claude-code", path: "/opt/homebrew/bin/claude" },
    [],
  );
  assert.equal(set.providers.find((p) => p.id === "claude-code")?.path, "/opt/homebrew/bin/claude");
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
    SettingsRefused,
  );
  assert.equal(dev.view().cliPaths, false);
  assert.deepEqual(looked, []);
  const desktop = service(true);
  const view = await desktop.change({ provider: "claude-code", path: "/opt/homebrew/bin/claude" });
  assert.equal(view.providers[0]?.path, "/opt/homebrew/bin/claude");
  assert.deepEqual(looked.at(-1), "/opt/homebrew/bin/claude");
});
