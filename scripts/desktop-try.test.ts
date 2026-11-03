import assert from "node:assert/strict";
import { test } from "node:test";
import { cliPath } from "../packages/server/src/settings.ts";
import { findPid, scenarioSettings, stale, standInScript } from "./desktop-try.ts";

test("a scenario's CLIs are in its throwaway home, at paths Settings takes", () => {
  const settings = scenarioSettings("/tmp/try/home");
  const paths = Object.fromEntries(settings.providers.map((p) => [p.kind, p.path]));
  assert.deepEqual(paths, {
    "claude-code": "/tmp/try/home/.local/bin/claude",
    codex: "/tmp/try/home/.local/bin/codex",
    api: undefined,
  });
  for (const p of settings.providers) if (p.path) assert.ok(cliPath(p.kind, p.path));
});

test("the stand-in runs from Settings' path with its folder, and refuses a quote", () => {
  assert.equal(
    standInScript("/n/node", "/r/stand-in-claude.ts", "/t/s"),
    `#!/bin/sh\nexec '/n/node' '/r/stand-in-claude.ts' '/t/s' "$@"\n`,
  );
  assert.throws(() => standInScript("/n/node", "/r/x.ts", "/t/it's"), /quote/);
});

test("the app is built again when a source is newer than it, or gone", () => {
  const times: Record<string, number> = { a: 5, b: 9 };
  const mtime = (path: string) => {
    const at = times[path];
    if (at === undefined) throw new Error("ENOENT");
    return at;
  };
  assert.equal(stale(["a", "b"], 10, mtime), false);
  assert.equal(stale(["a", "b"], 8, mtime), true);
  assert.equal(stale(["a", "gone"], 10, mtime), true);
});

test("the copy's PID is the one running its own executable, not a helper", () => {
  const exe = "/tmp/oriel-try-1/Oriel.app/Contents/MacOS/Oriel";
  const table = [
    "  101 /Applications/Oriel.app/Contents/MacOS/Oriel --data x",
    `  202 ${exe}/../../Frameworks/Oriel Helper.app/Contents/MacOS/Oriel Helper --type=gpu`,
    `  303 ${exe} --background --data /tmp/oriel-try-1/data --launch-file`,
  ].join("\n");
  assert.equal(findPid(table, exe), 303);
  assert.equal(findPid(table, "/tmp/oriel-try-2/Oriel.app/Contents/MacOS/Oriel"), null);
});
