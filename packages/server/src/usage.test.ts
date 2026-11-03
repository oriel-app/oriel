// How much of the plan Oriel has used (decision 0046): today's counts, kept
// as numbers only and started again each day, and the plan's windows as the
// person's Claude Code reports them, asked only of a CLI found and trusted.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ClaudeCode } from "@oriel/agent";
import { models } from "./model.ts";
import { defaultSettings } from "./settings.ts";
import { localDay, memoryUsage, usageFile } from "./usage.ts";

// As the harness reports a response: its input counts the cache's too.
const used = (input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({
  inputTokens: input + cacheRead + cacheWrite,
  outputTokens: output,
  cacheReadTokens: cacheRead,
  cacheWriteTokens: cacheWrite,
});

function inFolder(run: (path: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "oriel-usage-"));
  try {
    run(join(dir, "usage.json"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a turn counts once, every response's tokens count, and the next day starts again", () => {
  let day = "2026-11-03";
  const counts = memoryUsage(() => day);
  counts.count("claude-code", used(100, 20, 800, 50), true);
  counts.count("claude-code", used(10, 5), false);
  counts.count("claude-code-2", used(1, 1), true);
  assert.deepEqual(counts.today("claude-code"), { turns: 1, inputTokens: 960, outputTokens: 25 });
  assert.deepEqual(counts.today("claude-code-2"), { turns: 1, inputTokens: 1, outputTokens: 1 });
  day = "2026-11-04";
  assert.deepEqual(counts.today("claude-code"), { turns: 0, inputTokens: 0, outputTokens: 0 });
});

test("the file keeps counts and the day only, owner-only, and drops anything else", () => {
  inFolder((path) => {
    const today = () => "2026-11-03";
    usageFile(path, () => {}, today).count("claude-code", used(5, 2), true);
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), {
      day: "2026-11-03",
      instances: { "claude-code": { turns: 1, inputTokens: 5, outputTokens: 2 } },
    });
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.deepEqual(usageFile(path, () => {}, today).today("claude-code"), {
      turns: 1,
      inputTokens: 5,
      outputTokens: 2,
    });
    writeFileSync(
      path,
      JSON.stringify({
        day: "2026-11-03",
        instances: { "claude-code": { turns: -1, inputTokens: "9", said: "hi" }, "../x": {} },
      }),
    );
    const read = usageFile(path, () => {}, today);
    assert.deepEqual(read.today("claude-code"), { turns: 0, inputTokens: 0, outputTokens: 0 });
    read.count("claude-code", used(1, 1), false);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(path, "utf8")).instances), [
      "claude-code",
    ]);
    writeFileSync(path, "not json");
    const logged: string[] = [];
    usageFile(path, (message) => void logged.push(message), today);
    assert.deepEqual(logged, ["usage: unreadable, so counting starts again"]);
  });
});

test("a day is the local calendar's", () => {
  assert.equal(localDay(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
});

test("each Claude Code row's usage: today's counts and the plan its CLI reports, if found and trusted", async () => {
  const cli = { path: "/usr/local/bin/claude", version: "2.1.314" };
  const asked: ClaudeCode[] = [];
  const counts = memoryUsage(() => "2026-11-03");
  counts.count("claude-code", used(40, 4), true);
  const windows = [{ kind: "session" as const, usedPercent: 4, resetsAt: null }];
  let trusted: string | null = null;
  const chooser = models({
    key: null,
    env: { PATH: "" },
    check: async () => ({ ok: true, cli }),
    counts,
    plan: async (asking) => {
      asked.push(asking);
      return { windows };
    },
    trust: async () => trusted,
  });
  await chooser.look(defaultSettings);
  assert.deepEqual(await chooser.usage(defaultSettings), [
    {
      provider: "claude-code",
      today: { turns: 1, inputTokens: 40, outputTokens: 4 },
      plan: { windows },
    },
  ]);
  assert.deepEqual(asked, [cli]);
  // A CLI the trust check refuses isn't run to ask.
  trusted = "Anthropic's signature on this Claude Code doesn't check out.";
  assert.deepEqual((await chooser.usage(defaultSettings))[0]?.plan, { none: "not-ready" });
  assert.equal(asked.length, 1);
  // Nor is one not found.
  const missing = models({
    key: null,
    env: { PATH: "" },
    check: async () => ({ ok: false, problem: { kind: "missing", message: "Not here." } }),
    plan: async () => assert.fail("nothing to ask"),
  });
  await missing.look(defaultSettings);
  assert.deepEqual((await missing.usage(defaultSettings))[0]?.plan, { none: "not-ready" });
});
