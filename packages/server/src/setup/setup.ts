// The desktop app's first run, and the commands Settings shares with it
// (decision 0038). For the person's Claude Code: check, install, sign in,
// update and cancel; for their Codex, a preview (decision 0048): check, sign
// in and cancel. Each is a fixed command run as a child of the server, with
// what it's doing and, when it fails, one sentence and a log they can copy.
// Then the test turn that proves the plan answers, the AI chosen as a
// setting, and the first run's own steps, each done or skipped.
import { existsSync, realpathSync } from "node:fs";
import { arch, release, type } from "node:os";
import { join, sep } from "node:path";
import {
  claudeCodeMinVersion,
  claudeCodeTitler,
  type ClaudeCode,
  codexEnv,
  codexTitler,
  codexTooNew,
  codexVersion,
  defaultModel,
  locateClaudeCode,
  locateCodex,
  parseVersion,
  passedEnv,
  supportedVersion,
  type Titler,
  titleModel,
  tooNew,
} from "@oriel/agent";
import type { Instant, Log, TelemetryEvent, Ulid } from "@oriel/core";
import type {
  CliCommand,
  CliFailure,
  CliPhase,
  CliState,
  CliView,
  FirstRunView,
  SetupView,
} from "@oriel/web/view";
import { codexDefault, type Found, type Models } from "../model.ts";
import type { SettingsService, SettingsStore } from "../settings.ts";
import {
  type Account,
  codexSignIn,
  fetchText,
  install,
  installerUrl,
  latestUrl,
  type RunOptions,
  signIn,
  type Start,
  startChild,
  status,
  update,
} from "./cli.ts";
import { redacted } from "./redact.ts";
import { nextStep, type SetupState, type SetupStore } from "./state.ts";

// A test turn's outcome: the CLI's answer, or what it said instead, with the
// tokens it reported either way.
export type TestTurn = { said: string | null; inputTokens: number; outputTokens: number };

// The CLIs the setup runs commands for.
export type Cli = "claude-code" | "codex";

const cliNames: Record<Cli, string> = { "claude-code": "Claude Code", codex: "Codex" };

// The desktop app's side of the setup. Tests and `pnpm shots` stand in for
// the installer, the signature check, the test turn and the window.
export type SetupOptions = {
  state: SetupStore;
  // The data folder had nothing in it when the server started.
  fresh: boolean;
  home: string;
  // The environment the person's CLI is found in and started with.
  env: Readonly<Record<string, string | undefined>>;
  // Whether Oriel may run the CLI at a path: the model chooser's own check,
  // that a CLI from Anthropic's installer is signed by Anthropic.
  trust: (path: string) => Promise<string | null>;
  start?: Start;
  installer?: { script(): Promise<string>; latest(): Promise<string | null> };
  // On the CLI's smallest model for Claude Code, its default for Codex.
  testTurn?: (cli: ClaudeCode, kind: Cli, model: string) => Promise<TestTurn>;
  // Brings the window to the front, through the shell.
  front?: () => Promise<void>;
  // Every account shows as `placeholderAccount` instead of its own email
  // and plan: the desktop app started by a script (`pnpm desktop:try`),
  // whose screenshots may be published (OA-308).
  placeholder?: boolean;
};

// Who an account shows as when `placeholder` is on. Whether its plan is a
// personal one stays, since that says nothing about who it is.
export const placeholderAccount = { email: "you@example.com", plan: "Placeholder plan" };

export class SetupRefused extends Error {}

// An event as the setup gives it, before its time and workspace.
type Unstamped = TelemetryEvent extends infer E
  ? E extends TelemetryEvent
    ? Omit<E, "at" | "workspaceId">
    : never
  : never;

export type Setup = {
  // The plan and the account's email are read when the CLI is ready, once
  // for each CLI file, while the setup or Settings asks: shown, never kept
  // past the server, logged or sent.
  view(): Promise<SetupView>;
  // Whether every page opens the first run: until it has finished. Under
  // `pnpm dev` there's none.
  firstRun(): "pending" | "finished";
  // Starts a command for a CLI, Claude Code unless named, which runs on
  // after this returns, or checks again.
  command(command: CliCommand | "check" | "cancel", cli?: Cli): Promise<SetupView>;
  // The AI the person continues with: a CLI once a test turn answers (or,
  // `anyway`, past a usage limit).
  choose(ai: Cli, anyway: boolean): Promise<SetupView>;
  progress(did: Progress): Promise<SetupView>;
  // Resolves once no command is running.
  idle(): Promise<void>;
  // Stops whatever runs, as the server quits.
  close(): void;
};

export type Progress = "opened" | "skipped-ai" | "work" | "skipped-work" | "finished" | "dismissed";

// The largest log a command keeps: its last lines.
const maxLog = 200;
// A sign-in nobody finishes in the browser ends after this long.
const signInMs = 15 * 60 * 1000;

const commandStates: Record<CliCommand, CliState> = {
  install: "installing",
  "sign-in": "signing-in",
  update: "updating",
};

export function setupService(deps: {
  options: SetupOptions | null;
  models: Models | null;
  settings: SettingsService;
  store: SettingsStore;
  // Whether the person has a workstream of their own yet.
  made(): boolean;
  workspaceId: Ulid;
  emit(event: TelemetryEvent): void;
  now(): Instant;
  log: Log;
}): Setup {
  const { options, models, settings, store, now } = deps;
  const ms = (from: number) => Math.max(0, Date.parse(now()) - from);
  const emit = (event: Unstamped) =>
    deps.emit({ ...event, at: now(), workspaceId: deps.workspaceId } as TelemetryEvent);

  type Running = {
    cli: Cli;
    command: CliCommand;
    phase: CliPhase;
    startedAt: number;
    stop: () => void;
    cancelled: boolean;
  };
  let running: Running | null = null;
  // The command running now, to its end.
  let runs: Promise<void> = Promise.resolve();
  let log: string[] = [];
  // The last failure of each CLI's commands or test turn.
  const failed: Record<Cli, CliView["failed"]> = { "claude-code": null, codex: null };
  let account: Account | null = null;
  // The test turn found a plan without Claude Code, until the next sign-in.
  let noPlan = false;

  const setting = (kind: Cli) => store.get().providers.find((p) => p.kind === kind) ?? null;
  const found = (kind: Cli = "claude-code"): Found => {
    const instance = setting(kind);
    return instance && models ? models.found(instance.id) : { status: "checking" };
  };
  // The CLI's file, wherever it is, ready or not.
  const located = (kind: Cli = "claude-code") => {
    if (!options) return null;
    const path = setting(kind)?.path;
    return kind === "codex" ? locateCodex(options.env, path) : locateClaudeCode(options.env, path);
  };
  const start = options?.start ?? startChild;

  const note = (line: string) => {
    const at = running ? ms(running.startedAt) : 0;
    const clock = `${Math.floor(at / 60_000)}:${String(Math.floor(at / 1000) % 60).padStart(2, "0")}`;
    log.push(`${clock}  ${line}`);
    if (log.length > maxLog) log = log.slice(-maxLog);
  };

  async function look(): Promise<void> {
    await settings.look();
    accountOf = null;
    await readAccount();
  }

  // `claude auth status` for the CLI found ready, once per file, after the
  // trust check, one read at a time.
  let accountOf: string | null = null;
  let accountRead: Promise<void> | null = null;
  const readAccount = (): Promise<void> => {
    const at = found();
    const cli = at.status === "ready" ? at.cli : null;
    const of = cli ? `${cli.path}@${cli.version}` : null;
    if (of === accountOf) return accountRead ?? Promise.resolve();
    accountOf = of;
    accountRead = (async () => {
      const refused = cli && options ? await options.trust(cli.path) : "none";
      account =
        cli && options && !refused ? await status(cli.path, passedEnv(options.env), start) : null;
    })();
    return accountRead;
  };

  // How a version too old updates (decision 0038): Claude Code's own update,
  // unless Homebrew or npm installed it, whose command Oriel names instead.
  // Codex is always the person's own to update (decision 0048).
  function updateBy(kind: Cli): CliView["update"] {
    const path = located(kind);
    let real = "";
    try {
      real = path ? realpathSync(path) : "";
    } catch {
      return null;
    }
    if (kind === "codex") {
      if (real.includes(`${sep}Caskroom${sep}codex${sep}`))
        return { by: "person", command: "brew upgrade --cask codex" };
      if (real.includes(`${sep}node_modules${sep}@openai${sep}codex${sep}`))
        return { by: "person", command: "npm install -g @openai/codex@latest" };
      return null;
    }
    if (real.includes(`${sep}Caskroom${sep}claude-code${sep}`))
      return { by: "person", command: "brew upgrade --cask claude-code" };
    if (real.includes(`${sep}node_modules${sep}@anthropic-ai${sep}claude-code${sep}`))
      return { by: "person", command: "npm install -g @anthropic-ai/claude-code@latest" };
    return { by: "oriel" };
  }

  function cliView(kind: Cli = "claude-code"): CliView | null {
    if (!options) return null;
    const at = found(kind);
    const version =
      at.status === "ready"
        ? (at.cli?.version ?? null)
        : ((at.problem && "version" in at.problem ? at.problem.version : undefined) ?? null);
    const parsed = version
      ? kind === "codex"
        ? codexVersion(version)
        : parseVersion(version)
      : null;
    const newer = parsed && (kind === "codex" ? codexTooNew(parsed) : tooNew(parsed));
    const mine = running?.cli === kind ? running : null;
    const state: CliState = mine
      ? commandStates[mine.command]
      : at.status === "ready"
        ? noPlan && kind === "claude-code"
          ? "no-plan"
          : "ready"
        : at.status === "unsupported"
          ? newer
            ? "too-new"
            : "unsupported"
          : at.status === "missing" ||
              at.status === "signed-out" ||
              at.status === "untrusted" ||
              at.status === "checking"
            ? at.status
            : "missing";
    const signedIn = state === "ready" || state === "no-plan";
    const shown = !signedIn
      ? null
      : kind === "codex"
        ? at.status === "ready"
          ? (at.account ?? null)
          : null
        : account;
    return {
      state,
      version,
      account:
        shown && options.placeholder
          ? {
              email: shown.email && placeholderAccount.email,
              plan: shown.plan && placeholderAccount.plan,
              personal: shown.personal,
            }
          : shown,
      running: mine && {
        command: mine.command,
        phase: mine.phase,
        ms: ms(mine.startedAt),
      },
      update: state === "unsupported" ? updateBy(kind) : null,
      failed: failed[kind],
    };
  }

  function firstRunView(): FirstRunView | null {
    if (!options) return null;
    const state = options.state.get();
    const firstRun = state.finishedAt !== null && !deps.made();
    return {
      step: nextStep(state),
      steps: { ai: state.steps.ai ?? null, work: state.steps.work ?? null },
      firstRun,
      line: firstRun && !state.dismissed,
      // Nothing the window connects reports a first sync's progress since
      // decision 0059: a source server's first sync reads before the page
      // shows it.
      reading: null,
    };
  }

  const view = async (): Promise<SetupView> => {
    if (options) await readAccount();
    return viewNow();
  };
  const viewNow = (): SetupView => {
    // Claude Code's row, and Codex's once it's installed (decision 0048).
    const providers = options
      ? (models?.providers(store.get()) ?? []).filter(
          (p) => p.kind === "claude-code" || p.kind === "codex",
        )
      : [];
    return {
      providers,
      cli: cliView(),
      codex: providers.some((p) => p.kind === "codex") ? cliView("codex") : null,
      firstRun: firstRunView(),
    };
  };

  const save = (change: Partial<SetupState>) => {
    if (!options) return;
    options.state.set({ ...options.state.get(), ...change });
  };

  // Runs one command to its end, with the row's phase and log as it goes;
  // the page asks for the view while it runs.
  async function run(command: CliCommand, cli: Cli): Promise<void> {
    if (!options) return;
    const began = Date.parse(now());
    const current: Running = {
      cli,
      command,
      phase: command === "install" ? "downloading" : command === "sign-in" ? "waiting" : "updating",
      startedAt: began,
      stop: () => {},
      cancelled: false,
    };
    running = current;
    failed[cli] = null;
    log = [];
    note(`${type()} ${release()} · ${arch()}`);
    emit({ name: "cli.started", command, cli });
    const runOptions: RunOptions = {
      env: cli === "codex" ? codexEnv(options.env) : passedEnv(options.env),
      start,
      home: options.home,
      log: note,
      phase: (phase) => (current.phase = phase),
      // A child that starts after Cancel stops at once.
      stopping: (stop) => {
        current.stop = stop;
        if (current.cancelled) stop();
      },
    };
    let outcome: "done" | "failed" | "cancelled" = "failed";
    const fail = (why: CliFailure, sentence: string) => {
      failed[cli] = { what: command, why, sentence, log: [...log], resets: null };
    };
    try {
      if (command === "install") outcome = await installing(runOptions, current, fail);
      else {
        const path = located(cli);
        const refused = path ? await options.trust(path) : `Oriel can't find ${cliNames[cli]} now.`;
        if (refused || !path) {
          note(`Oriel's check: ${refused}`);
          fail("untrusted", `Oriel didn't run ${cliNames[cli]}: ${refused}`);
        } else if (current.cancelled) outcome = "cancelled";
        else if (command === "sign-in")
          outcome = await signingIn(runOptions, current, path, cli, fail);
        else outcome = await updating(runOptions, current, path, fail);
      }
    } catch (error) {
      deps.log("setup: a command failed", { command, error: String(error) });
      note(`Stopped: ${error instanceof Error ? error.message : String(error)}`);
      fail("other", "Oriel couldn't finish that. Try again, or show the details.");
    } finally {
      if (current.cancelled) {
        outcome = "cancelled";
        failed[cli] = null;
      }
      running = null;
      emit({ name: "cli.ended", command, outcome, ms: ms(began), cli });
    }
  }

  async function installing(
    runOptions: RunOptions,
    current: Running,
    fail: (why: CliFailure, sentence: string) => void,
  ): Promise<"done" | "failed"> {
    if (!options) return "failed";
    const installer = options.installer ?? {
      script: () => fetchText(installerUrl),
      latest: () => fetchText(latestUrl).then((text) => text.trim()),
    };
    let script: string;
    try {
      script = await installer.script();
    } catch (error) {
      note(
        `Couldn't download ${installerUrl}: ${error instanceof Error ? error.message : String(error)}`,
      );
      fail(
        "download",
        "Oriel couldn't download Anthropic's installer. A work network can block it; if trying again doesn't help, send the details to your IT team.",
      );
      return "failed";
    }
    // Its newest, unless that's one Oriel can't drive: then the version Oriel
    // was checked against, which the installer takes as an argument.
    const latest = await installer.latest().catch(() => null);
    // Cancelled while the installer downloaded: it never runs.
    if (current.cancelled) return "failed";
    const newest = latest ? parseVersion(latest) : null;
    const version = newest && !supportedVersion(newest) ? claudeCodeMinVersion : null;
    const ended = await install({ ...runOptions, script, version });
    if (current.cancelled) return "failed";
    if (ended.code !== 0) {
      note(
        `The installer stopped (exit ${ended.code ?? "by a signal"}) before Claude Code was set up.`,
      );
      fail(
        ended.phase === "downloading" ? "download" : "setting-up",
        ended.phase === "downloading"
          ? "Claude Code didn't finish installing. The download from Anthropic stopped partway. A work network can block it; if trying again doesn't help, send the details to your IT team."
          : "Claude Code didn't finish installing: setting it up stopped partway. Try again, or send the details to whoever helps you with your Mac.",
      );
      return "failed";
    }
    current.phase = "checking";
    const cli = join(options.home, ".local", "bin", "claude");
    if (!existsSync(cli)) {
      note("The installer ended, but no claude is in ~/.local/bin, where it puts it.");
      fail(
        "setting-up",
        "Claude Code didn't finish installing: the installer ended without setting it up. Try again, or send the details to whoever helps you with your Mac.",
      );
      return "failed";
    }
    note("Checking it's genuine: Anthropic's signature, and Apple's notarization");
    const refused = await options.trust(cli);
    if (refused) {
      note(`Oriel's check: ${refused}`);
      fail("untrusted", `Oriel didn't run the Claude Code that was installed. ${refused}`);
      // Its row says so too, from the look's own check.
      await look();
      return "failed";
    }
    note("It's Anthropic's");
    save({ installed: true });
    await look();
    return "done";
  }

  async function signingIn(
    runOptions: RunOptions,
    current: Running,
    path: string,
    cli: Cli,
    fail: (why: CliFailure, sentence: string) => void,
  ): Promise<"done" | "failed"> {
    const site = cli === "codex" ? "OpenAI" : "claude.ai";
    const timer = setTimeout(() => {
      note(`Nothing came back from ${site} in 15 minutes, so Oriel stopped waiting.`);
      current.stop();
    }, signInMs);
    timer.unref();
    const signing = cli === "codex" ? codexSignIn : signIn;
    const ended = await signing({ ...runOptions, cli: path }).finally(() => clearTimeout(timer));
    await options?.front?.().catch(() => {});
    if (cli === "claude-code") noPlan = false;
    await look();
    if (current.cancelled) return "failed";
    if (ended.code === 0 && found(cli).status === "ready") {
      save({ signedIn: true });
      return "done";
    }
    note(
      `${cliNames[cli]}'s sign-in ended (exit ${ended.code ?? "by a signal"}) without an account.`,
    );
    fail(
      "sign-in",
      `Sign-in didn't finish: nothing came back from ${site}. If you closed the tab or picked the wrong account, start again.`,
    );
    return "failed";
  }

  async function updating(
    runOptions: RunOptions,
    current: Running,
    cli: string,
    fail: (why: CliFailure, sentence: string) => void,
  ): Promise<"done" | "failed"> {
    const ended = await update({ ...runOptions, cli });
    await look();
    if (current.cancelled) return "failed";
    if (ended.code === 0 && found().status !== "unsupported") return "done";
    note(`Claude Code's update ended (exit ${ended.code ?? "by a signal"}).`);
    fail(
      "update",
      "Claude Code didn't finish updating. Try again, or send the details to whoever helps you with your Mac.",
    );
    return "failed";
  }

  // The one test turn, through the harness's title path on its smallest
  // model: the only check that proves the plan answers.
  const testTurn =
    options?.testTurn ??
    (async (cli: ClaudeCode, kind: Cli, model: string): Promise<TestTurn> => {
      const counted = { inputTokens: 0, outputTokens: 0 };
      const env = options?.env ?? {};
      const titler: Titler =
        kind === "codex" ? codexTitler({ cli, model, env }) : claudeCodeTitler({ cli, model, env });
      try {
        await titler(`Oriel checks that ${cliNames[kind]} answers.`, {
          signal: AbortSignal.timeout(120_000),
          log: (message, fields = {}) => {
            if (message !== "title: response") return;
            counted.inputTokens = Number(fields.input_tokens) || 0;
            counted.outputTokens = Number(fields.output_tokens) || 0;
          },
        });
        return { said: null, ...counted };
      } catch (error) {
        return { said: error instanceof Error ? error.message : String(error), ...counted };
      }
    });

  // The model a CLI's turns run on once chosen: Claude's largest, or Codex's
  // own default.
  const modelFor = (ai: Cli): string =>
    ai === "codex" ? codexDefault(found("codex")) : defaultModel;

  async function chosen(ai: Cli): Promise<void> {
    const instance = store.get().providers.find((p) => p.kind === ai);
    if (!instance) throw new SetupRefused("That AI isn't one Oriel lists.");
    await settings.change({ model: { provider: instance.id, model: modelFor(ai) } });
    emit({ name: "first-run.ai-chosen", ai });
    save({ steps: { ...options?.state.get().steps, ai: "done" } });
  }

  return {
    view,
    firstRun: () => (options && options.state.get().finishedAt === null ? "pending" : "finished"),
    async command(command, cli = "claude-code") {
      if (!options)
        throw new SetupRefused("Only the desktop app installs or signs in Claude Code.");
      // Oriel only signs Codex in: installing and updating it are the
      // person's own (decision 0048).
      if (cli === "codex" && (command === "install" || command === "update"))
        throw new SetupRefused("Oriel doesn't install or update Codex.");
      if (command === "cancel") {
        if (running?.cli === cli) {
          running.cancelled = true;
          running.stop();
        }
        return view();
      }
      // Start again: the sign-in running stops, and a fresh one starts.
      if (
        running &&
        command === "sign-in" &&
        running.command === "sign-in" &&
        running.cli === cli
      ) {
        running.cancelled = true;
        running.stop();
        await runs;
      }
      if (running)
        throw new SetupRefused("Oriel is already doing that. Wait for it, or cancel it.");
      if (command === "check") {
        failed[cli] = null;
        await look();
        return view();
      }
      // Runs on: the page asks for the view as it goes.
      runs = run(command, cli);
      return view();
    },
    async choose(ai, anyway) {
      if (!options) throw new SetupRefused("Only the desktop app has a first run.");
      const at = found(ai);
      if (running || at.status !== "ready" || !at.cli)
        throw new SetupRefused(`${cliNames[ai]} isn't ready yet.`);
      if (!anyway) {
        const began = Date.parse(now());
        // The file may have changed since Oriel looked: it runs only once the
        // check passes again.
        const refused = await options.trust(at.cli.path);
        if (refused) throw new SetupRefused(refused);
        const turn = await testTurn(at.cli, ai, ai === "codex" ? modelFor(ai) : titleModel);
        // The CLI's own words go only where they're redacted.
        const said = turn.said === null ? null : redacted(turn.said, options.home);
        const failure = said === null ? null : testFailure(said, ai);
        emit({
          name: "first-run.test-turn",
          ms: ms(began),
          inputTokens: turn.inputTokens,
          outputTokens: turn.outputTokens,
          ...(failure ? { failed: failure.why } : {}),
          cli: ai,
        });
        if (failure) {
          if (ai === "claude-code") noPlan = failure.why === "no-plan";
          failed[ai] = {
            what: "test",
            ...failure,
            log: [
              ai === "codex"
                ? "Oriel asked Codex one short question, on its default model."
                : "Oriel asked Claude Code one short question, on its smallest model.",
              said ?? "",
            ],
          };
          return view();
        }
      }
      failed[ai] = null;
      await chosen(ai);
      return view();
    },
    async progress(did) {
      if (!options) throw new SetupRefused("Only the desktop app has a first run.");
      const state = options.state.get();
      switch (did) {
        case "opened":
          if (state.openedAt === null) {
            save({ openedAt: now(), fresh: options.fresh });
            emit({ name: "first-run.opened", fresh: options.fresh });
            await look();
            const at = found();
            emit({ name: "first-run.cli-found", cli: "claude-code", state: at.status });
            const codex = store.get().providers.find((p) => p.kind === "codex");
            if (codex && models)
              emit({
                name: "first-run.cli-found",
                cli: "codex",
                state: models.found(codex.id).status,
              });
          } else await look();
          break;
        case "skipped-ai":
        case "skipped-work": {
          const step = did === "skipped-ai" ? "ai" : "work";
          save({ steps: { ...state.steps, [step]: "skipped" } });
          emit({ name: "first-run.step-skipped", step });
          break;
        }
        case "work":
          save({ steps: { ...state.steps, work: "done" } });
          break;
        case "finished":
          if (state.finishedAt === null) {
            save({
              finishedAt: now(),
              steps: { ai: state.steps.ai ?? "skipped", work: state.steps.work ?? "skipped" },
            });
            emit({
              name: "first-run.finished",
              ms: state.openedAt ? ms(Date.parse(state.openedAt)) : 0,
              installed: state.installed,
              signedIn: state.signedIn,
            });
          }
          break;
        case "dismissed":
          save({ dismissed: true });
          break;
      }
      return view();
    },
    idle: () => runs,
    close() {
      if (!running) return;
      running.cancelled = true;
      running.stop();
    },
  };
}

// What a test turn's failure says, from the CLI's own words (decision 0038):
// a usage limit, with when it resets; no connection; a plan without access;
// a configuration the harness refuses; or the CLI's own sentence.
export function testFailure(
  said: string,
  cli: Cli = "claude-code",
): {
  why: CliFailure;
  sentence: string;
  resets: string | null;
} {
  const name = cliNames[cli];
  const text = said.replace(new RegExp(`^${name} stopped: `), "");
  if (/\blimit\b/i.test(text) && /(usage|rate|hour|week|reached|hit)/i.test(text)) {
    const epoch = /\|(\d{10})\b/.exec(text)?.[1];
    const words = /\bresets?\s+(?:at\s+)?([^.·|]{1,40})/i.exec(text)?.[1]?.trim() ?? null;
    return {
      why: "usage-limit",
      sentence: `${name} is signed in, but your ${cli === "codex" ? "ChatGPT" : "Claude"} plan has reached its usage limit. You can finish setting up now; questions to Oriel wait until then.`,
      resets: epoch ? new Date(Number(epoch) * 1000).toISOString() : words,
    };
  }
  if (said.startsWith(`Oriel stopped ${name}`))
    return { why: "refused", sentence: said, resets: null };
  if (
    /(connection|network|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|getaddrinfo|offline|timed? ?out|unreachable)/i.test(
      text,
    )
  )
    return {
      why: "no-connection",
      sentence: `${name} couldn't reach ${cli === "codex" ? "OpenAI" : "Claude"} just now. A work network can block it; if trying again doesn't help, send the details to your IT team.`,
      resets: null,
    };
  if (
    /(subscription|your plan|does not include|doesn't include|not included|no access|access to claude code|upgrade|forbidden|\b403\b)/i.test(
      text,
    )
  )
    return {
      why: "no-plan",
      sentence:
        cli === "codex"
          ? "This account's plan doesn't include Codex."
          : "This account's plan doesn't include Claude Code. Claude Pro or Max does.",
      resets: null,
    };
  const first = text.trim().split("\n")[0]?.slice(0, 200) ?? "";
  return {
    why: "other",
    sentence: first ? `${name} didn't answer: ${first}` : `${name} didn't answer.`,
    resets: null,
  };
}
