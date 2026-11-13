import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { redacted } from "./redact.ts";
import {
  anthropicSigned,
  anthropicTeam,
  installerTrust,
  requirement,
  type RunTool,
} from "./signature.ts";

test("a CLI runs only when codesign finds Anthropic's Team ID and spctl finds it notarized", async () => {
  // codesign passes only when it is asked to check this path against a
  // requirement naming Anthropic's Team ID.
  const answers =
    (codesign: number, spctl: string): RunTool =>
    async (file, args) => {
      if (file !== "/usr/bin/codesign")
        return { code: spctl.includes(": accepted") ? 0 : 3, output: spctl };
      const checked = args.at(-1) === "/c" && args[args.indexOf("-R") + 1] === requirement;
      return checked && !codesign ? { code: 0, output: "" } : { code: 3, output: "failed" };
    };
  assert.ok(requirement.includes(`certificate leaf[subject.OU] = "${anthropicTeam}"`));
  assert.equal(
    await anthropicSigned("/c", answers(0, "/c: accepted\nsource=Notarized Developer ID\n")),
    null,
  );
  assert.ok(await anthropicSigned("/c", answers(3, "")));
  assert.ok(
    await anthropicSigned("/c", answers(0, "/c: rejected\nsource=Unnotarized Developer ID")),
  );
  // A tool that couldn't start refuses too.
  assert.ok(await anthropicSigned("/c", async () => ({ code: null, output: "" })));
});

test("only a CLI in the installer's folder is checked, once per file as it is", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "oriel-trust-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const versions = join(home, ".local", "share", "claude", "versions");
  mkdirSync(versions, { recursive: true });
  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  mkdirSync(join(home, "elsewhere"), { recursive: true });
  writeFileSync(join(versions, "2.1.317"), "one", { mode: 0o755 });
  symlinkSync(join(versions, "2.1.317"), join(home, ".local", "bin", "claude"));
  writeFileSync(join(home, "elsewhere", "claude"), "own", { mode: 0o755 });
  const checked: string[] = [];
  let refuse = false;
  const trust = installerTrust({
    home,
    verify: async (path) => {
      checked.push(path);
      return refuse ? { problem: "It isn't signed by Anthropic." } : null;
    },
  });
  const launcher = join(home, ".local", "bin", "claude");
  assert.equal(await trust(launcher), null);
  assert.equal(await trust(launcher), null);
  assert.equal(checked.length, 1);
  assert.match(checked[0] ?? "", /versions\/2\.1\.317$/);
  assert.equal(await trust(join(home, "elsewhere", "claude")), null);
  assert.equal(checked.length, 1);
  writeFileSync(join(versions, "2.1.317"), "changed, and longer", { mode: 0o755 });
  refuse = true;
  assert.equal(await trust(launcher), "It isn't signed by Anthropic.");
  assert.equal(checked.length, 2);
  assert.equal(await trust(join(home, "nowhere")), null);
});

test("the log a person copies holds no password, key, code, email or link query", () => {
  const home = "/Users/maya";
  const lines: [string, string][] = [
    [
      "visit: https://claude.ai/oauth/authorize?code=true&client_id=abc&state=xyz",
      "visit: https://claude.ai/oauth/authorize?…",
    ],
    ["Signed in as maya@example.com", "Signed in as [email]"],
    ["key sk-ant-api03-AbCdEf_123", "key [key]"],
    ["code: 4Hk9-QzLm", "code: [hidden]"],
    ["password=hunter2", "password=[hidden]"],
    ['{"password":"hunter2","code":123456}', '{"password":[hidden],"code":[hidden]}'],
    ["{'token': 'abc'}", "{'token': [hidden]}"],
    [String.raw`{"password":"a\"private-tail"}`, '{"password":[hidden]}'],
    [String.raw`secret="never \"closed`, "secret=[hidden]"],
    [String.raw`{"password":"https://example.com/?x=\"private-tail"}`, '{"password":[hidden]}'],
    ["Authorization: Bearer abcdefgh12345678", "Authorization: Bearer [hidden]"],
    ["session 7f3a9c1e5b2d4f6a8c0e1a3b5d7f9a1c", "session [hidden]"],
    ["Installed to /Users/maya/.local/bin/claude", "Installed to ~/.local/bin/claude"],
    ["\u001b[31mDownload failed\u001b[0m", "Download failed"],
    ["Setting up Claude Code...", "Setting up Claude Code..."],
    ["Claude Code is installed, with code signing", "Claude Code is installed, with code signing"],
  ];
  for (const [line, shown] of lines) assert.equal(redacted(line, home), shown);
  assert.equal(redacted("x".repeat(400), home).length, 301);
});
