// The first run's commands against stand-ins: an installer script that
// prints Anthropic's installer's lines and leaves a stub `claude` where it
// does, stub CLIs that answer `auth login`, `auth status` and `update` as
// Claude Code does, and a stub `codex` that answers `login` as Codex does.
// Each runs as a real child in a throwaway home, by
// /bin/bash, never from the network; the signature check, the test turn and
// the window's shell are stand-ins too.
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { locateClaudeCode, locateCodex } from "@oriel/agent";
import type { CheckOptions } from "@oriel/agent";
import type { SetupView } from "@oriel/web/view";
import { models } from "../model.ts";
import { memorySettings } from "../settings.ts";
import { json, testApp } from "../testing.ts";
import { startChild, type Start } from "./cli.ts";
import { type SetupOptions, type TestTurn } from "./setup.ts";
import { memorySetup } from "./state.ts";

// A stub `claude`, as a shell script. `login`: what `auth login` does, after
// printing the CLI's lines: sign in, or fail. `version`: what it says it is.
function stubCli(options: { version?: string; login?: "signs-in" | "fails" } = {}): string {
  const version = options.version ?? "2.1.317";
  return [
    "#!/bin/bash",
    'case "$1 $2" in',
    `  "--version ") echo "${version} (Claude Code)" ;;`,
    '  "auth login")',
    '    echo "$*" > "$HOME/login-args"',
    '    if [ -t 0 ]; then echo tty > "$HOME/login-stdin"; else cat > "$HOME/login-stdin"; fi',
    '    echo "Opening browser to sign in…"',
    '    echo "If the browser didn\'t open, visit: https://claude.ai/oauth/authorize?code=true&state=abcdefghijklmnopqrstuvwxyz0123456789"',
    options.login === "fails"
      ? '    echo "Signed in as maya@example.com, token: sk-ant-api03-secretsecretsecret"; exit 1 ;;'
      : '    touch "$HOME/.signed-in"; echo "Login successful." ;;',
    '  "auth status")',
    '    if [ -f "$HOME/.signed-in" ]; then',
    '      echo \'{"loggedIn":true,"authMethod":"claude.ai","email":"maya@example.com","subscriptionType":"pro"}\'',
    "    else echo '{\"loggedIn\":false}'; exit 1; fi ;;",
    '  "update ") echo "Updating…"; touch "$HOME/.updated" ;;',
    "  *) exit 2 ;;",
    "esac",
    "",
  ].join("\n");
}

// A stub `codex`: `login` prints Codex's lines, then signs in or fails.
function stubCodex(login: "signs-in" | "fails"): string {
  return [
    "#!/bin/bash",
    'if [ "$1" != "login" ]; then exit 2; fi',
    'echo "$*" > "$HOME/codex-login-args"',
    'if [ -t 0 ]; then echo tty > "$HOME/codex-login-stdin"; else cat > "$HOME/codex-login-stdin"; fi',
    'echo "Starting local login server on http://localhost:1455."',
    'echo "If your browser did not open, navigate to this URL to authenticate:"',
    'echo "https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_abcdefghijklmnop&code_challenge=abcdefghijklmnopqrstuvwxyz0123456789&state=zyxwvutsrqponmlkjihgfedcba9876543210"',
    login === "fails"
      ? 'echo "Login failed for maya@example.com"; exit 1'
      : 'touch "$HOME/.codex-signed-in"; echo "Successfully logged in"',
    "",
  ].join("\n");
}

// The installer as Anthropic's prints: nothing while it downloads, then
// "Setting up Claude Code...", then the binary sets itself up. This one
// notes what it was given, then leaves a stub CLI in the installer's places.
function stubInstaller(options: { fails?: "downloading" | "setting-up" } = {}): string {
  return [
    "#!/bin/bash",
    "set -e",
    'echo "PATH=$PATH" > "$HOME/installer-env"',
    'echo "args=$*" >> "$HOME/installer-env"',
    'if [ -t 0 ]; then echo "stdin=tty" >> "$HOME/installer-env"; else echo "stdin=$(cat)" >> "$HOME/installer-env"; fi',
    ...(options.fails === "downloading"
      ? [
          'echo "curl: (56) Recv failure: Connection reset by peer" >&2',
          'echo "Download failed" >&2',
          "exit 1",
        ]
      : []),
    'echo "Setting up Claude Code..."',
    ...(options.fails === "setting-up" ? ['echo "Install failed" >&2', "exit 1"] : []),
    'mkdir -p "$HOME/.local/share/claude/versions" "$HOME/.local/bin"',
    "cat > \"$HOME/.local/share/claude/versions/2.1.317\" <<'CLI'",
    stubCli().trimEnd(),
    "CLI",
    'chmod +x "$HOME/.local/share/claude/versions/2.1.317"',
    'ln -sf "$HOME/.local/share/claude/versions/2.1.317" "$HOME/.local/bin/claude"',
    'echo ""',
    'echo "✅ Installation complete!"',
    "",
  ].join("\n");
}

type World = {
  home: string;
  // Who brought the window to the front, and what the trust check saw.
  fronted: number;
  trusted: string[];
  // Each test turn, by CLI and model.
  tested: string[];
};

// A home with Claude Code installed or not, signed in or not, and the app
// over it with the first run, as the desktop app has it.
async function firstRun(
  t: Parameters<typeof testApp>[0] & { after(fn: () => void | Promise<void>): void },
  options: {
    // `brew`: where Homebrew's cask keeps it, linked from its bin.
    installed?: { version?: string; login?: "signs-in" | "fails"; brew?: true };
    signedIn?: boolean;
    installer?: string;
    // The installer's script arrives only when this resolves.
    script?: Promise<string>;
    latest?: string;
    trust?: (path: string) => string | null;
    testTurn?: TestTurn;
    start?: Start;
    // A stub Codex on the PATH, signed in or not, and how its sign-in ends.
    codex?: { signedIn?: boolean; login?: "signs-in" | "fails" };
    // Its update brings it up to date, and each check after it waits here.
    updates?: { held: (release: () => void) => void };
    // As under `pnpm desktop:try`.
    placeholder?: boolean;
  } = {},
) {
  const home = mkdtempSync(join(tmpdir(), "oriel-first-run-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const world: World = { home, fronted: 0, trusted: [], tested: [] };
  if (options.installed?.brew) {
    const cask = join(home, "homebrew", "Caskroom", "claude-code", "2.0.4");
    mkdirSync(cask, { recursive: true });
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    writeFileSync(join(cask, "claude"), stubCli(options.installed), { mode: 0o755 });
    symlinkSync(join(cask, "claude"), join(home, ".local", "bin", "claude"));
  } else if (options.installed) {
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    writeFileSync(join(home, ".local", "bin", "claude"), stubCli(options.installed), {
      mode: 0o755,
    });
  }
  if (options.signedIn) writeFileSync(join(home, ".signed-in"), "");
  if (options.codex) {
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    writeFileSync(
      join(home, ".local", "bin", "codex"),
      stubCodex(options.codex.login ?? "signs-in"),
      {
        mode: 0o755,
      },
    );
    if (options.codex.signedIn) writeFileSync(join(home, ".codex-signed-in"), "");
  }
  const env = { HOME: home, PATH: `/usr/bin:/bin:${join(home, ".local", "bin")}` };
  const trust = async (path: string) => {
    world.trusted.push(path);
    return options.trust?.(path) ?? null;
  };
  // The harness's check, as far as a stub answers it: found on the PATH, the
  // version it says, and signed in once its sign-in left its mark.
  const check = async ({ env: given, path }: CheckOptions) => {
    const cli = locateClaudeCode(given ?? {}, path);
    if (!cli)
      return { ok: false as const, problem: { kind: "missing" as const, message: "Not found." } };
    const updated = options.updates && existsSync(join(home, ".updated"));
    if (updated) await new Promise<void>((release) => options.updates?.held(release));
    const version = !updated && /\b2\.0\./.test(readFileSync(cli, "utf8")) ? "2.0.4" : "2.1.317";
    if (version === "2.0.4")
      return {
        ok: false as const,
        problem: { kind: "unsupported" as const, message: "Too old.", version },
      };
    return existsSync(join(home, ".signed-in"))
      ? { ok: true as const, cli: { path: cli, version } }
      : { ok: false as const, problem: { kind: "signed-out" as const, message: "Signed out." } };
  };
  // Codex's check, as far as its stub answers: found, and signed in once its
  // sign-in left its mark. The real check, which starts Codex, never runs.
  const checkCodex = async ({ env: given, path }: CheckOptions) => {
    const cli = locateCodex(given ?? {}, path);
    if (!cli)
      return { ok: false as const, problem: { kind: "missing" as const, message: "Not found." } };
    return existsSync(join(home, ".codex-signed-in"))
      ? {
          ok: true as const,
          cli: { path: cli, version: "0.166.0" },
          models: [{ id: "gpt-6.1-sol", label: "GPT-6.1-Sol", isDefault: true }],
          account: { plan: "ChatGPT Plus", email: "maya@example.com", personal: true },
        }
      : { ok: false as const, problem: { kind: "signed-out" as const, message: "Signed out." } };
  };
  const settings = memorySettings();
  const chooser = models({ key: null, env, check, checkCodex, trust });
  await chooser.look(settings.get());
  const state = memorySetup();
  const setup: SetupOptions = {
    state,
    fresh: true,
    home,
    env,
    trust,
    installer: {
      script: async () => (await options.script) ?? options.installer ?? stubInstaller(),
      latest: async () => options.latest ?? "2.1.317",
    },
    testTurn: async (_cli, kind, model) => {
      world.tested.push(`${kind} ${model}`);
      return options.testTurn ?? { said: null, inputTokens: 2900, outputTokens: 4 };
    },
    front: async () => {
      world.fronted += 1;
    },
    ...(options.start ? { start: options.start } : {}),
    ...(options.placeholder ? { placeholder: true } : {}),
  };
  const app = await testApp(t, { models: chooser, settings, setup });
  const view = async () => json<SetupView>(await app.get("/api/setup"));
  const send = async (path: string, body: unknown) => {
    const reply = await app.post(path, body);
    assert.equal(reply.status, 200, String(reply.body));
    return json<SetupView>(reply);
  };
  const events = (name: string) =>
    app.app.telemetry().flatMap((event) => (event.name === name ? [event.data] : []));
  return { ...app, world, state, settings, view, send, events };
}

test("a binary whose signature isn't Anthropic's is never run, and its row says so", async (t) => {
  const run = await firstRun(t, {
    trust: (path) =>
      path.endsWith(join(".local", "bin", "claude"))
        ? "It isn't signed by Anthropic, so Oriel won't run it."
        : null,
  });
  await run.send("/api/setup/cli", { command: "install" });
  await run.app.settled();
  const { cli, providers } = await run.view();
  assert.equal(cli?.state, "untrusted");
  assert.equal(cli?.failed?.why, "untrusted");
  assert.equal(providers.find((p) => p.kind === "claude-code")?.status, "untrusted");
  // Nor does a sign-in run it.
  await run.send("/api/setup/cli", { command: "sign-in" });
  await run.app.settled();
  assert.equal(existsSync(join(run.world.home, "login-args")), false);
});

test("under desktop:try, no page the window loads names the signed-in account (OA-308)", async (t) => {
  const run = await firstRun(t, {
    installed: {},
    signedIn: true,
    codex: { signedIn: true },
    placeholder: true,
  });
  const { cli, codex } = await run.view();
  for (const row of [cli, codex]) {
    assert.equal(row?.state, "ready");
    assert.deepEqual(row?.account, {
      email: "you@example.com",
      plan: "Placeholder plan",
      personal: true,
    });
  }
  // Every page the first run and Settings load, as the bytes the server
  // sends. Usage is numbers only, and the event streams carry only thread
  // events.
  for (const page of ["/api/setup", "/api/settings", "/api/overview"]) {
    const body = String((await run.get(page)).body);
    for (const identity of ["maya@example.com", "Claude Pro", "ChatGPT Plus"])
      assert.ok(!body.includes(identity), `${page} names ${identity}`);
  }
});

test("a sign-in that doesn't finish says so, and its log holds no email, key, code or link query", async (t) => {
  const run = await firstRun(t, { installed: { login: "fails" } });
  await run.send("/api/setup/cli", { command: "sign-in" });
  await run.app.settled();
  const { cli } = await run.view();
  assert.equal(cli?.state, "signed-out");
  assert.equal(cli?.failed?.why, "sign-in");
  const log = cli?.failed?.log.join("\n") ?? "";
  assert.ok(log.length > 0);
  for (const secret of [
    "maya@example.com",
    "sk-ant-",
    "abcdefghijklmnopqrstuvwxyz0123456789",
    "code=true",
  ])
    assert.ok(!log.includes(secret), `the log holds ${secret}`);
});

test("an update that worked says so, even when another look starts during the step's (OA-208)", async (t) => {
  // Each check after the update waits until the test lets it answer.
  const held: (() => void)[] = [];
  let waiting = Promise.withResolvers<void>();
  const run = await firstRun(t, {
    installed: { version: "2.0.4" },
    signedIn: true,
    updates: {
      held: (release) => {
        held.push(release);
        waiting.resolve();
      },
    },
  });
  await run.send("/api/setup/cli", { command: "update" });
  await waiting.promise;
  // The step's look is checking; the page opening starts a second.
  waiting = Promise.withResolvers<void>();
  const opened = run.send("/api/setup/progress", { did: "opened" });
  await waiting.promise;
  // The step's look answers first, and the page's after it.
  held[0]?.();
  await new Promise((resolve) => setImmediate(resolve));
  held[1]?.();
  await opened;
  await run.app.settled();
  const { cli } = await run.view();
  assert.equal(cli?.failed, null);
  assert.equal(cli?.state, "ready");
  assert.equal(held.length, 2);
});

test("Cancel while the installer downloads: it never runs", async (t) => {
  const started: string[] = [];
  const script = Promise.withResolvers<string>();
  const run = await firstRun(t, {
    script: script.promise,
    start: (file, args, options) => {
      started.push(file);
      return startChild(file, args, options);
    },
  });
  await run.send("/api/setup/cli", { command: "install" });
  await run.send("/api/setup/cli", { command: "cancel" });
  script.resolve(stubInstaller());
  await run.app.settled();
  assert.ok(!started.includes("/bin/bash"), "the installer ran after Cancel");
  assert.equal(existsSync(join(run.world.home, "installer-env")), false);
});
