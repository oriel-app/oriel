// The signature check by its tools' answers, and the trust check the model
// chooser asks before it runs a CLI: only one in Anthropic's installer's
// folder is checked, once per file as it is, and again when it changes.
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
  withLocalBin,
} from "./signature.ts";

test("codesign checks the file against Anthropic's Team ID, then spctl that it's notarized", async () => {
  const asked: string[][] = [];
  const answers =
    (codesign: number, spctl: string): RunTool =>
    async (file, args) => {
      asked.push([file, ...args]);
      return file === "/usr/bin/codesign"
        ? { code: codesign, output: codesign ? "test-requirement: code failed" : "" }
        : { code: spctl.includes(": accepted") ? 0 : 3, output: spctl };
    };
  assert.equal(
    await anthropicSigned("/c", answers(0, "/c: accepted\nsource=Notarized Developer ID\n")),
    null,
  );
  assert.deepEqual(asked, [
    ["/usr/bin/codesign", "--verify", "--strict", "-R", requirement, "/c"],
    [
      "/usr/sbin/spctl",
      "--assess",
      "--type",
      "open",
      "--context",
      "context:primary-signature",
      "--verbose",
      "/c",
    ],
  ]);
  assert.ok(requirement.includes(`certificate leaf[subject.OU] = "${anthropicTeam}"`));
  assert.ok(
    requirement.startsWith(
      "=anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6]",
    ),
  );
  assert.match(
    (await anthropicSigned("/c", answers(3, "")))?.problem ?? "",
    /isn't signed by Anthropic/,
  );
  assert.match(
    (await anthropicSigned("/c", answers(0, "/c: rejected\nsource=Unnotarized Developer ID")))
      ?.problem ?? "",
    /notarized/,
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
  // The file itself, through the launcher's link, checked once.
  assert.equal(checked.length, 1);
  assert.match(checked[0] ?? "", /versions\/2\.1\.317$/);
  // A person's own CLI elsewhere is theirs, run as decision 0037 says.
  assert.equal(await trust(join(home, "elsewhere", "claude")), null);
  assert.equal(checked.length, 1);
  // A changed file is checked again, and refused if it fails.
  writeFileSync(join(versions, "2.1.317"), "changed, and longer", { mode: 0o755 });
  refuse = true;
  assert.equal(await trust(launcher), "It isn't signed by Anthropic.");
  assert.equal(checked.length, 2);
  // Nothing there now: the look says so, not the check.
  assert.equal(await trust(join(home, "nowhere")), null);
});

test("the PATH gains the installer's bin once, last", () => {
  assert.equal(
    withLocalBin("/usr/bin:/bin", "/Users/maya"),
    "/usr/bin:/bin:/Users/maya/.local/bin",
  );
  assert.equal(
    withLocalBin("/Users/maya/.local/bin:/usr/bin", "/Users/maya"),
    "/Users/maya/.local/bin:/usr/bin",
  );
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
    // Plain words stay plain.
    ["Setting up Claude Code...", "Setting up Claude Code..."],
    ["Claude Code is installed, with code signing", "Claude Code is installed, with code signing"],
  ];
  for (const [line, shown] of lines) assert.equal(redacted(line, home), shown);
  assert.equal(redacted("x".repeat(400), home).length, 301);
});
