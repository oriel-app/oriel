// What the first run runs for the person's Claude Code (decision 0038), and
// how: a fixed list, every argument in code, never a string from the page.
// Each child runs in its own process group with stdin closed, so Cancel,
// Start again and quitting stop all of it, and nothing waits on a terminal.
// Its output becomes the log a person can copy, line by line, redacted.
import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { redacted } from "./redact.ts";
import { systemPath } from "./signature.ts";

// Anthropic's installer, at the one URL Oriel fetches it from, and where it
// says which version is newest.
export const installerUrl = "https://claude.ai/install.sh";
export const latestUrl = "https://downloads.claude.ai/claude-code-releases/latest";

const maxScript = 1024 * 1024;

// The line Anthropic's installer prints once its download checked out and
// the binary it downloaded starts setting itself up.
const settingUp = /^Setting up Claude Code/;

export type CliCommand = "install" | "sign-in" | "update";
// What a running command is doing, as its row says.
export type Phase = "downloading" | "setting-up" | "checking" | "waiting" | "updating";

// A child in its own process group. `stop` ends the group; `exited` is its
// exit code, or null when a signal ended it.
export type Child = { exited: Promise<number | null>; stop(): void };
export type Start = (
  file: string,
  args: readonly string[],
  options: { env: Record<string, string>; cwd: string; line(text: string): void },
) => Child;

// Every group still running. Being in their own groups, they'd outlive a
// server that exits without stopping them, so its exit ends them too.
const live = new Set<number>();
let ending = false;
const endAll = () => {
  for (const pid of live)
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // Already gone.
    }
};

export const startChild: Start = (file, args, { env, cwd, line }) => {
  const group = process.platform !== "win32";
  const child: ChildProcess = spawn(file, [...args], {
    env,
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    detached: group,
  });
  for (const stream of [child.stdout, child.stderr])
    if (stream) createInterface({ input: stream, crlfDelay: Infinity }).on("line", line);
  const exited = new Promise<number | null>((resolve) => {
    child.once("error", (error) => {
      line(`Couldn't start ${file}: ${error.message}`);
      resolve(127);
    });
    child.once("close", (code) => resolve(code));
  });
  let ended = false;
  const pid = child.pid;
  if (group && pid !== undefined) {
    live.add(pid);
    if (!ending) {
      ending = true;
      process.once("exit", endAll);
    }
  }
  void exited.then(() => {
    ended = true;
    if (pid !== undefined) live.delete(pid);
  });
  const signal = (name: NodeJS.Signals) => {
    if (ended || child.pid === undefined) return;
    try {
      if (group) process.kill(-child.pid, name);
      else child.kill(name);
    } catch {
      // Already gone.
    }
  };
  return {
    exited,
    stop() {
      signal("SIGTERM");
      // One that ignores SIGTERM goes anyway, a little later.
      setTimeout(() => signal("SIGKILL"), 3000).unref();
    },
  };
};

// Fetches a text over HTTPS, following redirects only to HTTPS addresses on
// claude.ai's own hosts.
export async function fetchText(url: string, send: typeof fetch = fetch): Promise<string> {
  let at = new URL(url);
  for (let hops = 0; hops < 4; hops++) {
    if (at.protocol !== "https:" || !/(^|\.)claude\.ai$/.test(at.hostname))
      throw new Error(`refused to fetch ${at.origin}: only HTTPS on claude.ai`);
    const response = await send(at, { redirect: "manual", signal: AbortSignal.timeout(60_000) });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      const next = response.headers.get("location");
      if (!next) throw new Error(`${at.host} redirected nowhere`);
      at = new URL(next, at);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`${at.host} answered ${response.status}`);
    }
    const text = await response.text();
    // Anthropic's installer is a few kilobytes.
    if (text.length > maxScript) throw new Error(`${at.host} sent more than an installer`);
    return text;
  }
  throw new Error("too many redirects");
}

// What each command is given, as it starts.
export type RunOptions = {
  // The person's environment from the harness's allowlist (decision 0037).
  env: Record<string, string>;
  start: Start;
  home: string;
  // Each line for the log, already redacted.
  log(line: string): void;
  phase(phase: Phase): void;
  // Stops the run's child when asked, until it ends.
  stopping(stop: () => void): void;
};

// How a command's child ended: its exit code, null for a signal, and the
// phase it was in.
export type Ended = { code: number | null; phase: Phase };

function run(
  file: string,
  args: readonly string[],
  env: Record<string, string>,
  cwd: string,
  options: RunOptions,
  onLine?: (line: string) => void,
  // What the log calls the command, when its own path says nothing useful.
  named?: string,
): Promise<number | null> {
  options.log(`Running ${named ?? [file, ...args].map(shown(options.home)).join(" ")}`);
  const child = options.start(file, args, {
    env,
    cwd,
    line(text) {
      const line = redacted(text, options.home);
      if (line.trim() !== "") options.log(line);
      onLine?.(text);
    },
  });
  options.stopping(() => child.stop());
  return child.exited;
}

const shown = (home: string) => (part: string) =>
  home.length > 1 ? part.split(home).join("~") : part;

// Anthropic's installer, run unmodified by /bin/bash from a folder only the
// person can open, with the system PATH in place of theirs, never with sudo.
// `version`: the one it installs, when its newest is one Oriel can't drive.
export async function install(
  options: RunOptions & { script: string; version: string | null },
): Promise<Ended> {
  const folder = mkdtempSync(join(tmpdir(), "oriel-install-"));
  try {
    const file = join(folder, "install.sh");
    writeFileSync(file, options.script, { mode: 0o600 });
    const sha = createHash("sha256").update(options.script).digest("hex");
    options.log(`Anthropic's installer, from ${installerUrl}, sha256 ${sha}`);
    if (options.version)
      options.log(`Installing Claude Code ${options.version}, which Oriel works with`);
    let phase: Phase = "downloading";
    options.phase(phase);
    const code = await run(
      "/bin/bash",
      [file, ...(options.version ? [options.version] : [])],
      { ...options.env, PATH: systemPath },
      folder,
      options,
      (line) => {
        if (phase === "downloading" && settingUp.test(line.trim())) {
          phase = "setting-up";
          options.phase(phase);
        }
      },
      `/bin/bash install.sh${options.version ? ` ${options.version}` : ""}`,
    );
    return { code, phase };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

// The CLI's own sign-in, in the person's browser, which it opens itself and
// which hands the sign-in back to the CLI. Stdin is closed: Oriel never
// writes to it, and never takes a code.
export async function signIn(options: RunOptions & { cli: string }): Promise<Ended> {
  options.phase("waiting");
  const code = await run(
    options.cli,
    ["auth", "login", "--claudeai"],
    options.env,
    tmpdir(),
    options,
  );
  return { code, phase: "waiting" };
}

// The CLI's own update, for a version too old.
export async function update(options: RunOptions & { cli: string }): Promise<Ended> {
  options.phase("updating");
  const code = await run(options.cli, ["update"], options.env, tmpdir(), options);
  return { code, phase: "updating" };
}

// The plan and the account's email, as `claude auth status --json` says
// them, read only to show in the row. Null when it doesn't say.
export type Account = { plan: string | null; email: string | null };

export function accountOf(output: string): Account | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const fields = parsed as Record<string, unknown>;
  if (fields.loggedIn !== true) return null;
  const text = (key: string) =>
    typeof fields[key] === "string" && fields[key] !== "" ? (fields[key] as string) : null;
  const plan = text("subscriptionType");
  return { plan: plan && planName(plan), email: text("email") };
}

// "max" → "Claude Max".
const planName = (plan: string) =>
  /^[a-z_]{1,20}$/.test(plan)
    ? `Claude ${plan.charAt(0).toUpperCase()}${plan.slice(1).replace(/_/g, " ")}`
    : null;

// `claude auth status --json`, which answers from the CLI's own files.
export function status(
  cli: string,
  env: Record<string, string>,
  start: Start,
): Promise<Account | null> {
  return new Promise((resolve) => {
    const lines: string[] = [];
    const child = start(cli, ["auth", "status", "--json"], {
      env,
      cwd: tmpdir(),
      line: (text) => lines.push(text),
    });
    const timer = setTimeout(() => child.stop(), 10_000);
    void child.exited.then(() => {
      clearTimeout(timer);
      resolve(accountOf(lines.join("\n")));
    });
  });
}
