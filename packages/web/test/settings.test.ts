// Settings (OA-181): each section has its own address; a change shows at
// once, the look on the page's <html> included, and goes to the server,
// whose answer to the last change stands; a refused one loads them again.
// Which key sends a question follows the setting.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Effect, Replied } from "../src/http.ts";
import { init as initRoot } from "../src/root.ts";
import { parseRoute, routeUrl } from "../src/route.ts";
import {
  initSettings,
  loadSettings,
  type SettingsModel,
  settingsReplied,
  sendKey,
  sends,
  updateSettings,
} from "../src/settings.ts";
import type { ProviderView, SettingsView } from "../src/view.ts";

const claudeCode: ProviderView = {
  id: "claude-code",
  kind: "claude-code",
  name: "Claude Code",
  on: true,
  status: "ready",
  detail: "Signed in · version 2.1.314",
  version: "2.1.314",
  path: null,
  uses: { model: "Opus 5.5", title: "Haiku 5.5" },
};
const view: SettingsView = {
  providers: [claudeCode],
  models: [{ provider: "claude-code", model: "claude-opus-5-5", label: "Opus 5.5 · Claude Code" }],
  model: { provider: "claude-code", model: "claude-opus-5-5" },
  titleModel: { provider: "claude-code", model: "claude-haiku-5-5" },
  scripted: false,
  cliPaths: true,
  apiKeys: false,
  theme: "graphite",
  themes: ["graphite", "broadsheet"],
  textSize: "default",
  send: "enter",
};
const loaded: SettingsModel = { ...initSettings(), view };
const replied = (tag: Replied["tag"], ok: boolean, body: unknown): Replied => ({
  type: "replied",
  tag,
  ok,
  body,
});
const posts = (effects: readonly Effect[]) =>
  effects.flatMap((e) => (e.type === "http" && e.method === "POST" ? [[e.url, e.body]] : []));

test("Settings has an address per section, and nothing else under it", () => {
  assert.deepEqual(parseRoute("/settings", ""), { page: "settings", section: "providers" });
  assert.deepEqual(parseRoute("/settings/appearance", ""), {
    page: "settings",
    section: "appearance",
  });
  assert.deepEqual(parseRoute("/settings/asking", ""), { page: "settings", section: "asking" });
  assert.equal(parseRoute("/settings/providers", "").page, "overview");
  for (const section of ["providers", "appearance", "asking"] as const) {
    const route = { page: "settings" as const, section };
    const url = routeUrl(route);
    assert.deepEqual(parseRoute(url, ""), route);
  }
});

test("settings load with any page but a review link's, which keeps the default look", () => {
  const loads = (path: string) => initRoot(parseRoute(path, ""))[1].includes(loadSettings);
  assert.equal(loads("/"), true);
  assert.equal(loads("/done"), true);
  assert.equal(loads("/settings/asking"), true);
  assert.equal(loads("/review/abc"), false);
});

test("a theme picked shows at once, with no reload, and goes to the server", () => {
  const [model, effects] = updateSettings(loaded, {
    type: "changed",
    change: { theme: "broadsheet" },
  });
  assert.equal(model.view?.theme, "broadsheet");
  assert.deepEqual(effects[0], { type: "showLook", theme: "broadsheet", textSize: "default" });
  assert.deepEqual(posts(effects), [["/api/settings", { theme: "broadsheet" }]]);
  // Turning a provider off shows at once too, and touches no look.
  const [off, offEffects] = updateSettings(loaded, {
    type: "changed",
    change: { provider: "claude-code", on: false },
  });
  assert.equal(off.view?.providers[0]?.on, false);
  assert.equal(
    offEffects.some((e) => e.type === "showLook"),
    false,
  );
});

test("only the answer to the last change stands, and a refused one loads them again", () => {
  let [model] = updateSettings(loaded, { type: "changed", change: { textSize: "large" } });
  [model] = updateSettings(model, { type: "changed", change: { textSize: "small" } });
  const early = settingsReplied(
    model,
    replied({ kind: "settingsChanged" }, true, { ...view, textSize: "large" }),
  );
  assert.equal(early[0].view?.textSize, "small");
  assert.deepEqual(early[1], []);
  const last = settingsReplied(
    early[0],
    replied({ kind: "settingsChanged" }, true, { ...view, textSize: "small" }),
  );
  assert.equal(last[0].pending, 0);
  assert.deepEqual(last[1], [{ type: "showLook", theme: "graphite", textSize: "small" }]);
  const [asked] = updateSettings(loaded, {
    type: "changed",
    change: { model: { provider: "api", model: "claude-opus-5-5" } },
  });
  const [refused, effects] = settingsReplied(
    asked,
    replied({ kind: "settingsChanged" }, false, {
      error: "That model's provider isn't connected and on.",
    }),
  );
  assert.equal(refused.problem, "That model's provider isn't connected and on.");
  assert.deepEqual(effects, [loadSettings]);
});

test("a path typed is saved as a change, and an emptied one is cleared", () => {
  let [model] = updateSettings(loaded, {
    type: "pathTyped",
    provider: "claude-code",
    text: " /opt/homebrew/bin/claude ",
  });
  let effects: Effect[];
  [model, effects] = updateSettings(model, { type: "pathSaved", provider: "claude-code" });
  assert.deepEqual(posts(effects), [
    ["/api/settings", { provider: "claude-code", path: "/opt/homebrew/bin/claude" }],
  ]);
  [model] = updateSettings(model, { type: "pathTyped", provider: "claude-code", text: "" });
  [, effects] = updateSettings(model, { type: "pathSaved", provider: "claude-code" });
  assert.deepEqual(posts(effects), [["/api/settings", { provider: "claude-code", path: null }]]);
});

test("Check again asks once, until it answers", () => {
  const [looking, effects] = updateSettings(loaded, { type: "lookClicked" });
  assert.deepEqual(posts(effects), [["/api/settings/look", {}]]);
  assert.deepEqual(updateSettings(looking, { type: "lookClicked" })[1], []);
  const [done] = settingsReplied(looking, replied({ kind: "settingsLooked" }, true, view));
  assert.equal(done.looking, false);
});

test("Enter sends, or Cmd/Ctrl+Enter does, as the person set it", () => {
  const key = (
    k: string,
    mods: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean; isComposing?: boolean } = {},
  ) => ({
    key: k,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    isComposing: false,
    ...mods,
  });
  assert.equal(sendKey(initSettings()), "enter");
  assert.equal(sends(key("Enter"), "enter"), true);
  assert.equal(sends(key("Enter", { shiftKey: true }), "enter"), false);
  assert.equal(sends(key("Enter", { isComposing: true }), "enter"), false);
  assert.equal(sends(key("Enter"), "mod-enter"), false);
  assert.equal(sends(key("Enter", { metaKey: true }), "mod-enter"), true);
  assert.equal(sends(key("Enter", { ctrlKey: true }), "mod-enter"), true);
  assert.equal(sends(key("a", { metaKey: true }), "mod-enter"), false);
});

test("a reply keeps a path typed since, and a reload after a refusal keeps saying why", () => {
  let [model] = updateSettings(loaded, {
    type: "pathTyped",
    provider: "claude-code",
    text: "/opt/homebrew/bin/claude",
  });
  [model] = updateSettings(model, {
    type: "changed",
    change: { provider: "claude-code", on: false },
  });
  [model] = settingsReplied(model, replied({ kind: "settingsChanged" }, true, view));
  assert.equal(model.paths["claude-code"], "/opt/homebrew/bin/claude");
  [model] = updateSettings(model, { type: "pathSaved", provider: "claude-code" });
  const kept = {
    ...view,
    providers: [{ ...claudeCode, path: "/opt/homebrew/bin/claude" }],
  };
  [model] = settingsReplied(model, replied({ kind: "settingsChanged" }, true, kept));
  assert.deepEqual(model.paths, {});

  [model] = updateSettings(loaded, {
    type: "changed",
    change: { provider: "claude-code", path: "/bin/sh" },
  });
  [model] = settingsReplied(
    model,
    replied({ kind: "settingsChanged" }, false, { error: "Give the full path." }),
  );
  [model] = settingsReplied(model, replied({ kind: "settings" }, true, view));
  assert.equal(model.problem, "Give the full path.");
});

test("an API key goes to the server once, is forgotten by the page, and a refusal says why", () => {
  let [model, effects] = updateSettings(loaded, { type: "keyTyped", text: "  sk-ant-typed  " });
  assert.equal(model.key, "  sk-ant-typed  ");
  assert.deepEqual(effects, []);
  [model, effects] = updateSettings(model, { type: "keySaved" });
  assert.deepEqual(posts(effects), [["/api/settings/key", { key: "sk-ant-typed" }]]);
  assert.equal(model.key, "");
  assert.equal(model.keying, true);
  // A second Save while it's checked sends nothing.
  assert.deepEqual(updateSettings(model, { type: "keySaved" })[1], []);
  const [refused] = settingsReplied(
    model,
    replied({ kind: "settingsKey" }, false, { error: "Anthropic doesn't accept that key." }),
  );
  assert.equal(refused.keying, false);
  assert.equal(refused.problem, "Anthropic doesn't accept that key.");
  const [kept] = settingsReplied(model, replied({ kind: "settingsKey" }, true, view));
  assert.equal(kept.keying, false);
  assert.equal(kept.problem, null);
  // Nothing typed, nothing sent; Remove sends null.
  assert.deepEqual(updateSettings(kept, { type: "keySaved" })[1], []);
  assert.deepEqual(posts(updateSettings(kept, { type: "keyRemoved" })[1]), [
    ["/api/settings/key", { key: null }],
  ]);
});
