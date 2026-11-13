// On Electron's utility process: no stdin, so the channel's text comes as messages on the parent port; no process group, so
// the server kills what it started as it exits; and Electron ends it with no exit hooks when the shell dies, hence the watcher.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PassThrough, type Readable } from "node:stream";
import { BroadcastChannel } from "node:worker_threads";
import { type ChildNews, childrenChannel, isChildNews, onChildren } from "@oriel/sandbox";
import { descendants } from "./processes.ts";

export { descendants };

export type ParentPort = {
  on(event: "message", listener: (event: { data: unknown }) => void): unknown;
  postMessage(message: unknown): void;
};

export function parentPort(): ParentPort | null {
  return (process as { parentPort?: ParentPort }).parentPort ?? null;
}

export function portPipes(port: ParentPort): { input: Readable; write: (line: string) => void } {
  const input = new PassThrough({ encoding: "utf8" });
  port.on("message", ({ data }) => {
    if (input.writableEnded) return;
    if (typeof data === "string") input.write(data);
    else if (data === null) input.end();
  });
  return { input, write: (line) => port.postMessage(line) };
}

// Synchronous, as an `exit` hook must be. setup/cli.ts keeps its own hook beside this one: it kills each CLI's whole group,
// which reaches a grandchild the CLI already left to launchd.
export function killDescendants(): void {
  if (process.platform === "win32") return;
  let table: string;
  try {
    table = execFileSync("/bin/ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8", env: {} });
  } catch {
    return;
  }
  for (const pid of descendants(table, process.pid))
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
}

// DENO_DIR names a folder that can't exist, so Deno caches nothing.
export function watcherCommand(deno: string): {
  file: string;
  args: string[];
  env: Record<string, string>;
} {
  return {
    file: deno,
    args: [
      "run",
      "--no-prompt",
      "--no-remote",
      "--no-npm",
      "--no-config",
      "--deny-net",
      "--deny-read",
      "--deny-write",
      "--deny-env",
      "--deny-ffi",
      "--deny-sys",
      "--deny-import",
      "--allow-run=/bin/ps,/bin/kill",
      fileURLToPath(new URL("./watcher.ts", import.meta.url)),
    ],
    env: { DENO_DIR: "/dev/null", DENO_NO_UPDATE_CHECK: "1" },
  };
}

// In a session of its own, so nothing aimed at the shell's group reaches it.
export function watchChildren(
  deno: string,
  log: (message: string, fields?: Record<string, unknown>) => void,
): { watcher: ChildProcess; stop(): void } | null {
  if (process.platform === "win32") return null;
  const { file, args, env } = watcherCommand(deno);
  const watcher = spawn(file, args, { env, detached: true, stdio: ["pipe", "ignore", "inherit"] });
  watcher.on("error", (error) => log("watcher: couldn't start", { error: String(error) }));
  watcher.stdin!.on("error", () => {});
  watcher.unref();
  (watcher.stdin as { unref?: () => void }).unref?.();
  const tell = ({ what, pid }: ChildNews) => {
    if (watcher.stdin!.writable) watcher.stdin!.write(`${what} ${pid}\n`);
  };
  const stopHearing = onChildren(tell);
  const relayed = new BroadcastChannel(childrenChannel);
  relayed.unref();
  relayed.onmessage = (event) => {
    const data = (event as { data?: unknown }).data;
    if (isChildNews(data)) tell(data);
  };
  return {
    watcher,
    stop() {
      stopHearing();
      relayed.close();
      watcher.stdin!.end();
    },
  };
}
