// Asking Claude Code for the plan's windows (decision 0046) runs the CLI, so
// it runs only one the trust check passes.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClaudeCode } from "@oriel/agent";
import { models } from "./model.ts";
import { defaultSettings } from "./settings.ts";

test("a CLI the trust check refuses isn't run to ask for its plan", async () => {
  const cli = { path: "/usr/local/bin/claude", version: "2.1.314" };
  const asked: ClaudeCode[] = [];
  let trusted: string | null = null;
  const chooser = models({
    key: null,
    env: { PATH: "" },
    check: async () => ({ ok: true, cli }),
    plan: async (asking) => {
      asked.push(asking);
      return { windows: [] };
    },
    trust: async () => trusted,
  });
  await chooser.look(defaultSettings);
  await chooser.usage(defaultSettings);
  assert.deepEqual(asked, [cli]);
  trusted = "Anthropic's signature on this Claude Code doesn't check out.";
  assert.deepEqual((await chooser.usage(defaultSettings))[0]?.plan, { none: "not-ready" });
  assert.equal(asked.length, 1);
});
