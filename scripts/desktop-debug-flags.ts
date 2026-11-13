// `pnpm desktop:debug-flags`; exits 1 if any flag or signal reaches a debugger in the built app,
// which could read the secrets it has opened from the OS's store.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { descendants } from "../packages/desktop/shell/rules.ts";
import { build, scenarioSettings } from "./desktop-try.ts";

type Way = {
  name: string;
  args?: (port: number, marker: string) => string[];
  env?: (port: number, marker: string) => Record<string, string>;
  // Sends SIGUSR1, which starts Node's inspector, to the shell and the server.
  signal?: boolean;
  // Hands the app a pipe on fds 3 and 4, as `--remote-debugging-pipe` reads.
  pipe?: boolean;
};

export const ways: Way[] = [
  { name: "no flag" },
  { name: "--remote-debugging-port", args: (port) => [`--remote-debugging-port=${port}`] },
  { name: "-remote-debugging-port", args: (port) => [`-remote-debugging-port=${port}`] },
  { name: "--remote-debugging-pipe", args: () => ["--remote-debugging-pipe"], pipe: true },
  { name: "--inspect", args: (port) => [`--inspect=127.0.0.1:${port}`] },
  { name: "--inspect-brk", args: (port) => [`--inspect-brk=127.0.0.1:${port}`] },
  { name: "--inspect-wait", args: (port) => [`--inspect-wait=127.0.0.1:${port}`] },
  { name: "--inspect-port and SIGUSR1", args: (port) => [`--inspect-port=${port}`], signal: true },
  { name: "SIGUSR1", signal: true },
  {
    name: "--log-net-log",
    args: (_, marker) => [`--log-net-log=${marker}`, "--net-log-capture-mode=IncludeSensitive"],
  },
  {
    name: "ELECTRON_RUN_AS_NODE",
    env: () => ({ ELECTRON_RUN_AS_NODE: "1" }),
    args: (_, marker) => ["-e", `require("fs").writeFileSync(${JSON.stringify(marker)}, "ran")`],
  },
  {
    name: "NODE_OPTIONS",
    env: (port, marker) => ({
      NODE_OPTIONS: `--inspect=127.0.0.1:${port} --require ${marker}.cjs`,
    }),
  },
];

const freePort = () =>
  new Promise<number>((resolve) => {
    const server = net.createServer().listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export function listening(lsof: string): { pid: number; port: number }[] {
  const found: { pid: number; port: number }[] = [];
  let pid = 0;
  for (const line of lsof.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    const port = /^n.*:(\d+)$/.exec(line)?.[1];
    if (port) found.push({ pid, port: Number(port) });
  }
  return found;
}

function listeners(pids: number[]) {
  // With no -p, lsof lists every process's.
  if (pids.length === 0) return [];
  try {
    return listening(
      execFileSync(
        "lsof",
        ["-nP", "-a", "-iTCP", "-sTCP:LISTEN", "-p", pids.join(","), "-F", "pn"],
        {
          encoding: "utf8",
        },
      ),
    );
  } catch {
    // lsof exits 1 when nothing matches.
    return [];
  }
}

export function isDebugger(body: string): boolean {
  try {
    const parsed = JSON.parse(body) as unknown;
    return typeof parsed === "object" && parsed !== null && "Protocol-Version" in parsed;
  } catch {
    return false;
  }
}

async function debuggerOn(port: number): Promise<boolean> {
  try {
    const reply = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(2_000),
    });
    return isDebugger(await reply.text());
  } catch {
    return false;
  }
}

async function pipeAnswers(child: ChildProcess): Promise<boolean> {
  const [, , , input, output] = child.stdio as unknown as [
    unknown,
    unknown,
    unknown,
    NodeJS.WritableStream | null,
    NodeJS.ReadableStream | null,
  ];
  if (!input || !output) return false;
  let answered = false;
  output.on("data", () => (answered = true));
  output.on("error", () => {});
  input.on("error", () => {});
  input.write(`${JSON.stringify({ id: 1, method: "Browser.getVersion" })}\0`);
  await pause(3_000);
  return answered;
}

const table = () => execFileSync("/bin/ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" });

async function stop(pid: number, tree: number[]) {
  if (alive(pid)) process.kill(pid, "SIGTERM");
  for (let waited = 0; waited < 10_000 && tree.some(alive); waited += 100) await pause(100);
  for (const each of tree.filter(alive)) process.kill(each, "SIGKILL");
}

type Seen = { started: boolean; ended: boolean; debuggers: string[]; listeners: number };

async function launch(executable: string, folder: string, way: Way): Promise<Seen> {
  const port = await freePort();
  const run = mkdtempSync(join(folder, "run-"));
  const data = join(run, "data");
  const home = join(run, "home");
  const marker = join(run, "ran");
  mkdirSync(data, { mode: 0o700 });
  mkdirSync(join(home, ".local/bin"), { recursive: true, mode: 0o700 });
  writeFileSync(join(data, "settings.json"), JSON.stringify(scenarioSettings(home)), {
    mode: 0o600,
  });
  writeFileSync(
    `${marker}.cjs`,
    `require("fs").writeFileSync(${JSON.stringify(marker)}, "ran");\n`,
  );
  const child = spawn(
    executable,
    [...(way.args?.(port, marker) ?? []), "--background", "--data", data, "--launch-file"],
    {
      env: { HOME: home, PATH: "/usr/bin:/bin:/usr/sbin:/sbin", ...way.env?.(port, marker) },
      stdio: ["ignore", "ignore", "ignore", ...(way.pipe ? (["pipe", "pipe"] as const) : [])],
    },
  );
  const pid = child.pid!;
  let exited = false;
  child.on("exit", () => (exited = true));
  const launchFile = join(data, "Shell/launch.json");
  for (let waited = 0; waited < 45_000 && !exited && !existsSync(launchFile); waited += 200)
    await pause(200);
  await pause(1_500);
  // Kept from the start: a process the shell leaves when a signal ends it becomes launchd's child.
  const owned = new Set([pid, ...descendants(table(), pid)]);
  const tree = () => {
    const now = table();
    for (const each of owned) for (const child of descendants(now, each)) owned.add(child);
    return [...owned].filter(alive);
  };
  if (way.signal) {
    for (const each of tree()) process.kill(each, "SIGUSR1");
    await pause(1_500);
  }
  const ports = listeners(tree());
  const debuggers: string[] = [];
  for (const { pid: owner, port: open } of ports)
    if (await debuggerOn(open)) debuggers.push(`a debugger on port ${open}, pid ${owner}`);
  if (!ports.some((open) => open.port === port) && (await debuggerOn(port)))
    debuggers.push(`a debugger on port ${port}`);
  if (way.pipe && (await pipeAnswers(child))) debuggers.push("an answer on the pipe");
  if (existsSync(marker)) debuggers.push(`it wrote ${marker}`);
  const started = existsSync(launchFile);
  const ended = exited;
  await stop(pid, tree());
  return { started, ended, debuggers, listeners: ports.length };
}

if (import.meta.main) {
  if (process.platform !== "darwin") {
    console.error("Only the macOS app is built so far.");
    process.exit(1);
  }
  const app = build(false);
  const folder = realpathSync(mkdtempSync(join(tmpdir(), "oriel-debug-flags-")));
  const copy = join(folder, "Oriel.app");
  execFileSync("ditto", [app, copy]);
  const executable = join(copy, "Contents/MacOS/Oriel");
  const problems: string[] = [];
  try {
    for (const way of ways) {
      const seen = await launch(executable, folder, way);
      const outcome = seen.debuggers.length
        ? `OPEN: ${seen.debuggers.join(", ")}`
        : `closed (${seen.started ? (seen.ended ? "ran, then ended" : `ran, ${seen.listeners} listening`) : "refused to start"})`;
      console.log(`${way.name.padEnd(28)} ${outcome}`);
      if (way.name === "no flag" && (!seen.started || seen.listeners === 0))
        problems.push(
          "without a flag the app didn't start or showed no port, so the run proves nothing",
        );
      if (way.args && seen.started) problems.push(`${way.name}: the app took it`);
      problems.push(...seen.debuggers.map((found) => `${way.name}: ${found}`));
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log("No way in opened a debugger.");
}
