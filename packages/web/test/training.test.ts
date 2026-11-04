// A ready CLI signed in with a personal plan says its vendor may train on
// the person's chats, with a link to that vendor's setting (OA-226); an API
// key, a commercial plan, or a row that isn't ready says nothing. Node can't
// render a .tsx row, so the rows' use of the line is read from their source;
// `pnpm shots setup` and `pnpm shots settings` show it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { trainingNotice } from "../src/training.ts";

const personal = { plan: "Claude Max", email: "maya@example.com", personal: true };
const apiKey = { plan: null, email: null, personal: false };

test("a personal plan's row points at its vendor's training setting", () => {
  assert.deepEqual(trainingNotice("claude-code", { state: "ready", account: personal }), {
    vendor: "Anthropic",
    page: "https://claude.ai/settings/data-privacy-controls",
  });
  assert.deepEqual(
    trainingNotice("codex", { state: "ready", account: { ...personal, plan: "ChatGPT Plus" } }),
    { vendor: "OpenAI", page: "https://chatgpt.com/#settings/DataControls" },
  );
});

test("an API key, a commercial plan or a row that isn't ready says nothing", () => {
  for (const kind of ["claude-code", "codex"] as const) {
    assert.equal(trainingNotice(kind, { state: "ready", account: apiKey }), null);
    assert.equal(trainingNotice(kind, { state: "ready", account: null }), null);
    assert.equal(trainingNotice(kind, { state: "no-plan", account: personal }), null);
    assert.equal(trainingNotice(kind, { state: "signed-out", account: null }), null);
  }
});

test("both CLI rows, in the first run and in Settings, show the line", () => {
  const rows = readFileSync(new URL("../src/cli-row.tsx", import.meta.url), "utf8");
  assert.match(rows, /<TrainingLine kind="claude-code" cli=\{cli\} \/>/);
  assert.match(rows, /<TrainingLine kind="codex" cli=\{cli\} \/>/);
  for (const page of ["setup-page.tsx", "settings-page.tsx"]) {
    const source = readFileSync(new URL(`../src/${page}`, import.meta.url), "utf8");
    assert.match(source, /<ClaudeCodeRow\b/, page);
    assert.match(source, /<CodexRow\b/, page);
  }
});
