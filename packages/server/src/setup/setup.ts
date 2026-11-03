// The desktop app's first run, and the commands Settings shares with it
// (decision 0038). For the person's Claude Code: check, install, sign in,
// update and cancel, each a fixed command run as a child of the server, with
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
  defaultModel,
  locateClaudeCode,
  parseVersion,
  passedEnv,
  supportedVersion,
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
import type { Found, Models } from "../model.ts";
import type { SettingsService, SettingsStore } from "../settings.ts";
import {
  type Account,
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
  testTurn?: (cli: ClaudeCode) => Promise<TestTurn>;
  // Brings the window to the front, through the shell.
  front?: () => Promise<void>;
};

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
  // Starts a command, which runs on after this returns, or checks again.
  command(command: CliCommand | "check" | "cancel"): Promise<SetupView>;
  // The AI the person continues with: Claude Code once a test turn answers
  // (or, `anyway`, past a usage limit), or the API key Settings kept.
  choose(ai: "claude-code" | "api", anyway: boolean): Promise<SetupView>;
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
  // Jira's first sync, while it reads or where it stopped.
  reading(): FirstRunView["reading"];
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
  let failed: CliView["failed"] = null;
  let account: Account | null = null;
  // The test turn found a plan without Claude Code, until the next sign-in.
  let noPlan = false;

  const claudeSetting = () => store.get().providers.find((p) => p.kind === "claude-code") ?? null;
  const found = (): Found => {
    const claude = claudeSetting();
    return claude && models ? models.found(claude.id) : { status: "checking" };
  };
  // The CLI's file, wherever it is, ready or not.
  const located = () => {
    if (!options) return null;
    const claude = claudeSetting();
    return locateClaudeCode(options.env, claude?.path);
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
  function updateBy(): CliView["update"] {
    const path = located();
    let real = "";
    try {
      real = path ? realpathSync(path) : "";
    } catch {
      return null;
    }
    if (real.includes(`${sep}Caskroom${sep}claude-code${sep}`))
      return { by: "person", command: "brew upgrade --cask claude-code" };
    if (real.includes(`${sep}node_modules${sep}@anthropic-ai${sep}claude-code${sep}`))
      return { by: "person", command: "npm install -g @anthropic-ai/claude-code@latest" };
    return { by: "oriel" };
  }

  function cliView(): CliView | null {
    if (!options) return null;
    const at = found();
    const version =
      at.status === "ready"
        ? (at.cli?.version ?? null)
        : ((at.problem && "version" in at.problem ? at.problem.version : undefined) ?? null);
    const parsed = version ? parseVersion(version) : null;
    const state: CliState = running
      ? commandStates[running.command]
      : at.status === "ready"
        ? noPlan
          ? "no-plan"
          : "ready"
        : at.status === "unsupported"
          ? parsed && tooNew(parsed)
            ? "too-new"
            : "unsupported"
          : at.status === "missing" ||
              at.status === "signed-out" ||
              at.status === "untrusted" ||
              at.status === "checking"
            ? at.status
            : "missing";
    return {
      state,
      version,
      account: state === "ready" || state === "no-plan" ? account : null,
      running: running && {
        command: running.command,
        phase: running.phase,
        ms: ms(running.startedAt),
      },
      update: state === "unsupported" ? updateBy() : null,
      failed,
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
      reading: deps.reading(),
    };
  }

  const view = async (): Promise<SetupView> => {
    if (options) await readAccount();
    return viewNow();
  };
  const viewNow = (): SetupView => ({
    // Claude Code's row, and Codex's once it's found, which Oriel can't run
    // on yet (decision 0040).
    providers: options
      ? (models?.providers(store.get()) ?? []).filter(
          (p) => p.kind === "claude-code" || (p.kind === "codex" && p.status === "not-yet"),
        )
      : [],
    cli: cliView(),
    firstRun: firstRunView(),
  });

  const save = (change: Partial<SetupState>) => {
    if (!options) return;
    options.state.set({ ...options.state.get(), ...change });
  };

  // Runs one command to its end, with the row's phase and log as it goes;
  // the page asks for the view while it runs.
  async function run(command: CliCommand): Promise<void> {
    if (!options) return;
    const began = Date.parse(now());
    const current: Running = {
      command,
      phase: command === "install" ? "downloading" : command === "sign-in" ? "waiting" : "updating",
      startedAt: began,
      stop: () => {},
      cancelled: false,
    };
    running = current;
    failed = null;
    log = [];
    note(`${type()} ${release()} · ${arch()}`);
    emit({ name: "cli.started", command });
    const runOptions: RunOptions = {
      env: passedEnv(options.env),
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
      failed = { what: command, why, sentence, log: [...log], resets: null };
    };
    try {
      if (command === "install") outcome = await installing(runOptions, current, fail);
      else {
        const cli = located();
        const refused = cli ? await options.trust(cli) : "Oriel can't find Claude Code now.";
        if (refused || !cli) {
          note(`Oriel's check: ${refused}`);
          fail("untrusted", `Oriel didn't run Claude Code: ${refused}`);
        } else if (current.cancelled) outcome = "cancelled";
        else if (command === "sign-in") outcome = await signingIn(runOptions, current, cli, fail);
        else outcome = await updating(runOptions, current, cli, fail);
      }
    } catch (error) {
      deps.log("setup: a command failed", { command, error: String(error) });
      note(`Stopped: ${error instanceof Error ? error.message : String(error)}`);
      fail("other", "Oriel couldn't finish that. Try again, or show the details.");
    } finally {
      if (current.cancelled) {
        outcome = "cancelled";
        failed = null;
      }
      running = null;
      emit({ name: "cli.ended", command, outcome, ms: ms(began) });
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
    cli: string,
    fail: (why: CliFailure, sentence: string) => void,
  ): Promise<"done" | "failed"> {
    const timer = setTimeout(() => {
      note("Nothing came back from claude.ai in 15 minutes, so Oriel stopped waiting.");
      current.stop();
    }, signInMs);
    timer.unref();
    const ended = await signIn({ ...runOptions, cli }).finally(() => clearTimeout(timer));
    await options?.front?.().catch(() => {});
    noPlan = false;
    await look();
    if (current.cancelled) return "failed";
    if (ended.code === 0 && found().status === "ready") {
      save({ signedIn: true });
      return "done";
    }
    note(`Claude Code's sign-in ended (exit ${ended.code ?? "by a signal"}) without an account.`);
    fail(
      "sign-in",
      "Sign-in didn't finish: nothing came back from claude.ai. If you closed the tab or picked the wrong account, start again.",
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
    (async (cli: ClaudeCode): Promise<TestTurn> => {
      const counted = { inputTokens: 0, outputTokens: 0 };
      const titler = claudeCodeTitler({ cli, env: options?.env ?? {} });
      try {
        await titler("Oriel checks that Claude Code answers.", {
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

  async function chosen(ai: "claude-code" | "api"): Promise<void> {
    const instance = store.get().providers.find((p) => p.kind === ai);
    if (!instance) throw new SetupRefused("That AI isn't one Oriel lists.");
    await settings.change({ model: { provider: instance.id, model: defaultModel } });
    emit({ name: "first-run.ai-chosen", ai });
    save({ steps: { ...options?.state.get().steps, ai: "done" } });
  }

  return {
    view,
    firstRun: () => (options && options.state.get().finishedAt === null ? "pending" : "finished"),
    async command(command) {
      if (!options)
        throw new SetupRefused("Only the desktop app installs or signs in Claude Code.");
      if (command === "cancel") {
        if (running) {
          running.cancelled = true;
          running.stop();
        }
        return view();
      }
      // Start again: the sign-in running stops, and a fresh one starts.
      if (running && command === "sign-in" && running.command === "sign-in") {
        running.cancelled = true;
        running.stop();
        await runs;
      }
      if (running)
        throw new SetupRefused("Oriel is already doing that. Wait for it, or cancel it.");
      if (command === "check") {
        failed = null;
        await look();
        return view();
      }
      // Runs on: the page asks for the view as it goes.
      runs = run(command);
      return view();
    },
    async choose(ai, anyway) {
      if (!options) throw new SetupRefused("Only the desktop app has a first run.");
      if (ai === "api") {
        await settings.look();
        if (models?.found("api").status !== "ready")
          throw new SetupRefused("Add an API key first.");
        await chosen("api");
        return view();
      }
      const at = found();
      if (running || at.status !== "ready" || !at.cli)
        throw new SetupRefused("Claude Code isn't ready yet.");
      if (!anyway) {
        const began = Date.parse(now());
        // The file may have changed since Oriel looked: it runs only once the
        // check passes again.
        const refused = await options.trust(at.cli.path);
        if (refused) throw new SetupRefused(refused);
        const turn = await testTurn(at.cli);
        // The CLI's own words go only where they're redacted.
        const said = turn.said === null ? null : redacted(turn.said, options.home);
        const failure = said === null ? null : testFailure(said);
        emit({
          name: "first-run.test-turn",
          ms: ms(began),
          inputTokens: turn.inputTokens,
          outputTokens: turn.outputTokens,
          ...(failure ? { failed: failure.why } : {}),
        });
        if (failure) {
          noPlan = failure.why === "no-plan";
          failed = {
            what: "test",
            ...failure,
            log: ["Oriel asked Claude Code one short question, on its smallest model.", said ?? ""],
          };
          return view();
        }
      }
      failed = null;
      await chosen("claude-code");
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
export function testFailure(said: string): {
  why: CliFailure;
  sentence: string;
  resets: string | null;
} {
  const text = said.replace(/^Claude Code stopped: /, "");
  if (/\blimit\b/i.test(text) && /(usage|rate|hour|week|reached|hit)/i.test(text)) {
    const epoch = /\|(\d{10})\b/.exec(text)?.[1];
    const words = /\bresets?\s+(?:at\s+)?([^.·|]{1,40})/i.exec(text)?.[1]?.trim() ?? null;
    return {
      why: "usage-limit",
      sentence:
        "Claude Code is signed in, but your Claude plan has reached its usage limit. You can finish setting up now; questions to Oriel wait until then.",
      resets: epoch ? new Date(Number(epoch) * 1000).toISOString() : words,
    };
  }
  if (said.startsWith("Oriel stopped Claude Code"))
    return { why: "refused", sentence: said, resets: null };
  if (
    /(connection|network|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|getaddrinfo|offline|timed? ?out|unreachable)/i.test(
      text,
    )
  )
    return {
      why: "no-connection",
      sentence:
        "Claude Code couldn't reach Claude just now. A work network can block it; if trying again doesn't help, send the details to your IT team.",
      resets: null,
    };
  if (
    /(subscription|your plan|does not include|doesn't include|not included|no access|access to claude code|upgrade|forbidden|\b403\b)/i.test(
      text,
    )
  )
    return {
      why: "no-plan",
      sentence: "This account's plan doesn't include Claude Code. Claude Pro or Max does.",
      resets: null,
    };
  const first = text.trim().split("\n")[0]?.slice(0, 200) ?? "";
  return {
    why: "other",
    sentence: first ? `Claude Code didn't answer: ${first}` : "Claude Code didn't answer.",
    resets: null,
  };
}
