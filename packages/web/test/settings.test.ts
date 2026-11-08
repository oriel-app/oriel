// An API key typed in Settings goes to the server once and the page forgets
// it, whatever the server answers.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Effect, Replied } from "../src/http.ts";
import {
  initSettings,
  type SettingsModel,
  settingsReplied,
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
  notify: true,
  notifies: false,
  askBeforeQuitting: true,
  asksBeforeQuitting: false,
  timeFormat: "relative",
  afterApprove: "stay",
  sourceSync: null,
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

test("an API key goes to the server once and is forgotten by the page, refused or not", () => {
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
    replied({ kind: "settingsKey" }, false, { error: "Not accepted." }),
  );
  assert.equal(refused.keying, false);
  assert.equal(refused.key, "");
  assert.ok(refused.problem);
  const [kept] = settingsReplied(model, replied({ kind: "settingsKey" }, true, view));
  assert.equal(kept.keying, false);
  assert.equal(kept.problem, null);
  // Nothing typed, nothing sent; Remove sends null.
  assert.deepEqual(updateSettings(kept, { type: "keySaved" })[1], []);
  assert.deepEqual(posts(updateSettings(kept, { type: "keyRemoved" })[1]), [
    ["/api/settings/key", { key: null }],
  ]);
});
