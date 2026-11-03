// The first run's commands against stand-ins: an installer script that
// prints Anthropic's installer's lines and leaves a stub `claude` where it
// does, and stub CLIs that answer `auth login`, `auth status` and `update` as
// Claude Code does. Each runs as a real child in a throwaway home, by
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
import { locateClaudeCode } from "@oriel/agent";
import type { CheckOptions } from "@oriel/agent";
import type { SetupView } from "@oriel/web/view";
import { models } from "../model.ts";
import { memorySettings } from "../settings.ts";
import { json, testApp } from "../testing.ts";
import { startChild, type Start } from "./cli.ts";
import { type SetupOptions, testFailure, type TestTurn } from "./setup.ts";
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
  } = {},
) {
  const home = mkdtempSync(join(tmpdir(), "oriel-first-run-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const world: World = { home, fronted: 0, trusted: [] };
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
    const version = /\b2\.0\./.test(readFileSync(cli, "utf8")) ? "2.0.4" : "2.1.317";
    if (version === "2.0.4")
      return {
        ok: false as const,
        problem: { kind: "unsupported" as const, message: "Too old.", version },
      };
    return existsSync(join(home, ".signed-in"))
      ? { ok: true as const, cli: { path: cli, version } }
      : { ok: false as const, problem: { kind: "signed-out" as const, message: "Signed out." } };
  };
  const settings = memorySettings();
  const chooser = models({ key: null, env, check, trust });
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
    testTurn: async () => options.testTurn ?? { said: null, inputTokens: 2900, outputTokens: 4 },
    front: async () => {
      world.fronted += 1;
    },
    ...(options.start ? { start: options.start } : {}),
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

test("missing, installed by Anthropic's installer, signed in, then chosen: one row, start to end", async (t) => {
  const run = await firstRun(t);
  // Every page opens the first run until it has finished.
  assert.equal((await run.get("/")).headers.location, "/setup");
  assert.equal((await run.get("/settings")).headers.location, "/setup");
  assert.equal((await run.get("/setup")).status, 200);

  let view = await run.send("/api/setup/progress", { did: "opened" });
  assert.equal(view.cli?.state, "missing");
  assert.equal(view.firstRun?.step, "ai");
  assert.deepEqual(run.events("first-run.opened"), [{ fresh: true }]);
  assert.deepEqual(run.events("first-run.cli-found"), [
    { cli: "claude-code", state: "missing" },
    { cli: "codex", state: "missing" },
  ]);

  view = await run.send("/api/setup/cli", { command: "install" });
  assert.equal(view.cli?.state, "installing");
  assert.equal(view.cli?.running?.command, "install");
  await run.app.settled();
  view = await run.view();
  assert.equal(view.cli?.state, "signed-out");
  assert.equal(view.cli?.failed, null);
  // Run unmodified by bash with the system PATH, no argument for a version
  // Oriel drives, and nothing on stdin.
  const installed = readFileSync(join(run.world.home, "installer-env"), "utf8");
  assert.match(installed, /^PATH=\/usr\/bin:\/bin:\/usr\/sbin:\/sbin$/m);
  assert.match(installed, /^args=$/m);
  assert.match(installed, /^stdin=$/m);
  // What it installed was checked before Oriel ran it.
  assert.equal(run.world.trusted[0], join(run.world.home, ".local", "bin", "claude"));
  assert.deepEqual(
    run.events("cli.ended").map(({ command, outcome }) => [command, outcome]),
    [["install", "done"]],
  );

  view = await run.send("/api/setup/cli", { command: "sign-in" });
  assert.equal(view.cli?.state, "signing-in");
  await run.app.settled();
  view = await run.view();
  assert.equal(view.cli?.state, "ready");
  assert.deepEqual(view.cli?.account, { plan: "Claude Pro", email: "maya@example.com" });
  assert.equal(run.world.fronted, 1);
  // The CLI's own sign-in, for a subscription, with nothing on its stdin.
  assert.equal(
    readFileSync(join(run.world.home, "login-args"), "utf8").trim(),
    "auth login --claudeai",
  );
  assert.equal(readFileSync(join(run.world.home, "login-stdin"), "utf8"), "");

  view = await run.send("/api/setup/ai", { ai: "claude-code" });
  assert.equal(view.firstRun?.steps.ai, "done");
  assert.deepEqual(run.settings.get().model, { provider: "claude-code", model: "claude-opus-5-5" });
  assert.deepEqual(run.events("first-run.test-turn"), [
    { ms: 0, inputTokens: 2900, outputTokens: 4 },
  ]);
  assert.deepEqual(run.events("first-run.ai-chosen"), [{ ai: "claude-code" }]);

  await run.send("/api/setup/progress", { did: "skipped-work" });
  view = await run.send("/api/setup/progress", { did: "finished" });
  assert.equal(view.firstRun?.step, "finished");
  assert.deepEqual(run.events("first-run.finished"), [{ ms: 0, installed: true, signedIn: true }]);
  // Once finished, it never shows again.
  assert.equal((await run.get("/setup")).headers.location, "/");
  assert.equal((await run.get("/")).status, 200);
});

test("the installer's newest past what Oriel drives installs the verified version instead", async (t) => {
  const run = await firstRun(t, { latest: "3.0.1" });
  await run.send("/api/setup/cli", { command: "install" });
  await run.app.settled();
  assert.match(readFileSync(join(run.world.home, "installer-env"), "utf8"), /^args=2\.1\.314$/m);
});

test("an install that stops says what is known, in its phase, with a log to copy", async (t) => {
  for (const [fails, said] of [
    ["downloading", /The download from Anthropic stopped partway/],
    ["setting-up", /setting it up stopped partway/],
  ] as const) {
    const run = await firstRun(t, { installer: stubInstaller({ fails }) });
    await run.send("/api/setup/cli", { command: "install" });
    await run.app.settled();
    const { cli } = await run.view();
    assert.equal(cli?.state, "missing");
    assert.match(cli?.failed?.sentence ?? "", said);
    assert.doesNotMatch(cli?.failed?.sentence ?? "", /nothing changed/i);
    assert.equal(cli?.failed?.why, fails === "downloading" ? "download" : "setting-up");
    assert.ok(cli?.failed?.log.some((line) => line.includes("sha256")));
    assert.deepEqual(
      run.events("cli.ended").map(({ outcome }) => outcome),
      ["failed"],
    );
  }
});

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
  assert.match(cli?.failed?.sentence ?? "", /isn't signed by Anthropic/);
  assert.equal(providers.find((p) => p.kind === "claude-code")?.status, "untrusted");
  // Nor does a sign-in run it.
  await run.send("/api/setup/cli", { command: "sign-in" });
  await run.app.settled();
  assert.equal(existsSync(join(run.world.home, "login-args")), false);
});

test("a sign-in that doesn't finish says so, and its log holds no email, key, code or link query", async (t) => {
  const run = await firstRun(t, { installed: { login: "fails" } });
  await run.send("/api/setup/cli", { command: "sign-in" });
  await run.app.settled();
  const { cli } = await run.view();
  assert.equal(cli?.state, "signed-out");
  assert.equal(cli?.failed?.why, "sign-in");
  assert.match(cli?.failed?.sentence ?? "", /nothing came back from claude\.ai/);
  const log = cli?.failed?.log.join("\n") ?? "";
  assert.match(log, /Opening browser to sign in/);
  assert.match(log, /https:\/\/claude\.ai\/oauth\/authorize\?…/);
  for (const secret of [
    "maya@example.com",
    "sk-ant-",
    "abcdefghijklmnopqrstuvwxyz0123456789",
    "code=true",
  ])
    assert.ok(!log.includes(secret), `the log holds ${secret}`);
  assert.equal(run.world.fronted, 1);
});

test("a version too old updates itself; a Homebrew one is the person's command", async (t) => {
  const run = await firstRun(t, { installed: { version: "2.0.4" }, signedIn: true });
  let { cli } = await run.view();
  assert.equal(cli?.state, "unsupported");
  assert.deepEqual(cli?.update, { by: "oriel" });
  await run.send("/api/setup/cli", { command: "update" });
  await run.app.settled();
  assert.ok(existsSync(join(run.world.home, ".updated")));
  ({ cli } = await run.view());
  // The stub still says 2.0.4, so the update didn't fix it.
  assert.equal(cli?.failed?.why, "update");

  // Homebrew's is the person's own: Oriel names its command and runs none.
  const brewed = await firstRun(t, { installed: { version: "2.0.4", brew: true }, signedIn: true });
  assert.deepEqual((await brewed.view()).cli?.update, {
    by: "person",
    command: "brew upgrade --cask claude-code",
  });
});

test("Cancel stops the whole command, and the row is as it was", async (t) => {
  // A child that runs until it's stopped.
  const stopped: string[] = [];
  const start: Start = (file, args, options) => {
    if (file !== "/bin/bash") return startChild(file, args, options);
    const exited = Promise.withResolvers<number | null>();
    options.line("Downloading…");
    return {
      exited: exited.promise,
      stop() {
        stopped.push(file);
        exited.resolve(null);
      },
    };
  };
  const run = await firstRun(t, { start });
  await run.send("/api/setup/cli", { command: "install" });
  const busy = await run.post("/api/setup/cli", { command: "sign-in" });
  assert.equal(busy.status, 409);
  await run.send("/api/setup/cli", { command: "cancel" });
  await run.app.settled();
  const { cli } = await run.view();
  assert.deepEqual(stopped, ["/bin/bash"]);
  assert.equal(cli?.state, "missing");
  assert.equal(cli?.failed, null);
  assert.deepEqual(
    run.events("cli.ended").map(({ outcome }) => outcome),
    ["cancelled"],
  );
});

test("a test turn that fails says why, offers the way on, and chooses nothing", async (t) => {
  const run = await firstRun(t, {
    installed: {},
    signedIn: true,
    testTurn: {
      said: "Claude Code stopped: Claude AI usage limit reached|1762189200",
      inputTokens: 0,
      outputTokens: 0,
    },
  });
  let view = await run.send("/api/setup/ai", { ai: "claude-code" });
  assert.equal(view.cli?.failed?.why, "usage-limit");
  assert.equal(view.cli?.failed?.resets, "2025-11-03T17:00:00.000Z");
  assert.equal(view.firstRun?.steps.ai, null);
  assert.equal(run.settings.get().model, null);
  assert.deepEqual(run.events("first-run.test-turn"), [
    { ms: 0, inputTokens: 0, outputTokens: 0, failed: "usage-limit" },
  ]);
  // Continue anyway, past a usage limit.
  view = await run.send("/api/setup/ai", { ai: "claude-code", anyway: true });
  assert.equal(view.firstRun?.steps.ai, "done");
  assert.equal(view.cli?.failed, null);
});

test("a plan without Claude Code is the no-plan state", async (t) => {
  const run = await firstRun(t, {
    installed: {},
    signedIn: true,
    testTurn: {
      said: "Claude Code stopped: Your current subscription does not include Claude Code.",
      inputTokens: 0,
      outputTokens: 0,
    },
  });
  const view = await run.send("/api/setup/ai", { ai: "claude-code" });
  assert.equal(view.cli?.state, "no-plan");
  assert.equal(view.cli?.failed?.why, "no-plan");
});

test("the test turn's failures, each in a sentence the person can act on", () => {
  const cases: [string, string][] = [
    ["Claude Code stopped: Claude AI usage limit reached|1762189200", "usage-limit"],
    ["Claude Code stopped: 5-hour limit reached ∙ resets 3pm (Europe/London)", "usage-limit"],
    ["Claude Code stopped: API Error: Connection error.", "no-connection"],
    ["Claude Code stopped: getaddrinfo ENOTFOUND api.anthropic.com", "no-connection"],
    ["Oriel stopped Claude Code: it loaded tools other than run.", "refused"],
    [
      "Claude Code stopped: Your organization does not include Claude Code in your plan.",
      "no-plan",
    ],
    ["Claude Code stopped: Something else entirely.", "other"],
  ];
  for (const [said, why] of cases) assert.equal(testFailure(said).why, why, said);
  assert.equal(testFailure(cases[1]![0]).resets, "3pm (Europe/London)");
  assert.equal(
    testFailure(cases[4]![0]).sentence,
    "Oriel stopped Claude Code: it loaded tools other than run.",
  );
});

test("a step done or skipped is kept, and the setup reopens at the first neither", async (t) => {
  const run = await firstRun(t);
  let view = await run.send("/api/setup/progress", { did: "skipped-ai" });
  assert.equal(view.firstRun?.step, "work");
  assert.deepEqual(run.state.get().steps, { ai: "skipped" });
  assert.deepEqual(run.events("first-run.step-skipped"), [{ step: "ai" }]);
  view = await run.send("/api/setup/progress", { did: "work" });
  assert.equal(view.firstRun?.step, "work");
  view = await run.send("/api/setup/progress", { did: "finished" });
  assert.equal(view.firstRun?.step, "finished");
  // The first run's overview: the line, and the instruction among the
  // questions, until a workstream is made or the line dismissed.
  assert.equal(view.firstRun?.firstRun, true);
  assert.equal(view.firstRun?.line, true);
  view = await run.send("/api/setup/progress", { did: "dismissed" });
  assert.equal(view.firstRun?.line, false);
  assert.equal(view.firstRun?.firstRun, true);
});

test("under pnpm dev there is no first run and nothing to install", async (t) => {
  const app = await testApp(t);
  const view = json<SetupView>(await app.get("/api/setup"));
  assert.deepEqual(view, { providers: [], cli: null, firstRun: null });
  assert.equal((await app.get("/")).status, 200);
  assert.equal((await app.get("/setup")).headers.location, "/");
  assert.equal((await app.post("/api/setup/cli", { command: "install" })).status, 409);
  assert.equal((await app.post("/api/setup/cli", { command: "rm -rf" })).status, 400);
});

test("an installer that ends well without leaving Claude Code says it didn't finish", async (t) => {
  const run = await firstRun(t, {
    installer: ["#!/bin/bash", 'echo "Setting up Claude Code..."', "exit 0", ""].join("\n"),
  });
  await run.send("/api/setup/cli", { command: "install" });
  await run.app.settled();
  const { cli } = await run.view();
  assert.equal(cli?.state, "missing");
  assert.equal(cli?.failed?.why, "setting-up");
  assert.match(cli?.failed?.sentence ?? "", /didn't finish installing/);
  assert.deepEqual(
    run.events("cli.ended").map(({ outcome }) => outcome),
    ["failed"],
  );
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
  assert.deepEqual(
    run.events("cli.ended").map(({ outcome }) => outcome),
    ["cancelled"],
  );
});

test("Start again stops the sign-in running, and a fresh one starts", async (t) => {
  // The first sign-in waits in the browser until it's stopped.
  const stopped: string[] = [];
  let first = true;
  const start: Start = (file, args, options) => {
    if (args[0] !== "auth" || args[1] !== "login" || !first) return startChild(file, args, options);
    first = false;
    const exited = Promise.withResolvers<number | null>();
    return {
      exited: exited.promise,
      stop() {
        stopped.push(args.join(" "));
        exited.resolve(null);
      },
    };
  };
  const run = await firstRun(t, { installed: {}, start });
  await run.send("/api/setup/cli", { command: "sign-in" });
  const again = await run.send("/api/setup/cli", { command: "sign-in" });
  assert.equal(again.cli?.state, "signing-in");
  await run.app.settled();
  assert.deepEqual(stopped, ["auth login --claudeai"]);
  assert.equal((await run.view()).cli?.state, "ready");
  assert.deepEqual(
    run.events("cli.ended").map(({ outcome }) => outcome),
    ["cancelled", "done"],
  );
});
