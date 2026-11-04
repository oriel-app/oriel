// What changes when the server runs on the shell's own Node, as Electron's
// utility process (decision 0047), and not as a plain child.
//
// - The channel. A utility process has no stdin, so the channel's text comes
//   and goes as messages on the parent port, the pipe only the shell holds:
//   each string the shell sends is text it would have written to stdin, and
//   `null` is stdin's end. Each line the server writes goes back as one
//   string. The text is PROTOCOL.md's, unchanged.
// - Its group. A utility process can't lead a process group, so nothing the
//   server starts shares one the shell could kill. Instead, as it exits, the
//   server kills whatever it started that is still running, by the process
//   table: a Deno, a tsc, the person's CLI, and theirs.
// - Its watcher. When the shell dies, Electron ends the server at once, with
//   no exit hooks, so the server tells a watcher outside both processes each
//   process it starts, and the watcher kills what's left once the server is
//   gone (watcher.ts).
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PassThrough, type Readable } from "node:stream";
import { BroadcastChannel } from "node:worker_threads";
import { type ChildNews, childrenChannel, isChildNews, onChildren } from "@oriel/sandbox";
import { descendants } from "./processes.ts";

export { descendants };

// Electron's `process.parentPort`, as much of it as the channel uses.
export type ParentPort = {
  on(event: "message", listener: (event: { data: unknown }) => void): unknown;
  postMessage(message: unknown): void;
};

// The parent port, when this process is Electron's utility process.
export function parentPort(): ParentPort | null {
  return (process as { parentPort?: ParentPort }).parentPort ?? null;
}

// The channel's stdin and stdout, over the parent port. Anything but a
// string or `null` is dropped, as a line that can't be read is.
export function portPipes(port: ParentPort): { input: Readable; write: (line: string) => void } {
  const input = new PassThrough({ encoding: "utf8" });
  port.on("message", ({ data }) => {
    if (input.writableEnded) return;
    if (typeof data === "string") input.write(data);
    else if (data === null) input.end();
  });
  return { input, write: (line) => port.postMessage(line) };
}

// Kills what this process started that is still running. Synchronous, as an
// `exit` hook must be. setup/cli.ts keeps its own hook beside this one: it
// kills each CLI's whole group, which reaches a grandchild the CLI already
// left to launchd, where this finds only what is still under the server.
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

// The watcher's command line: Deno with nothing allowed but running `ps` and
// `kill`. DENO_DIR names a folder that can't exist, so Deno caches nothing.
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

// Starts the watcher, in a session of its own so nothing aimed at the shell's
// group reaches it, and tells it each process this one starts from now on,
// in any thread, and each that ends (@oriel/sandbox, onChildren). Its stderr is
// this process's, so what it says reaches the log. `stop` is for tests: it
// stops telling, and ends the watcher's stdin as this process's death would.
export function watchChildren(
  deno: string,
  log: (message: string, fields?: Record<string, unknown>) => void,
): { watcher: ChildProcess; stop(): void } | null {
  if (process.platform === "win32") return null;
  const { file, args, env } = watcherCommand(deno);
  const watcher = spawn(file, args, { env, detached: true, stdio: ["pipe", "ignore", "inherit"] });
  watcher.on("error", (error) => log("watcher: couldn't start", { error: String(error) }));
  watcher.stdin!.on("error", () => {});
  // Neither keeps this process running.
  watcher.unref();
  (watcher.stdin as { unref?: () => void }).unref?.();
  const tell = ({ what, pid }: ChildNews) => {
    if (watcher.stdin!.writable) watcher.stdin!.write(`${what} ${pid}\n`);
  };
  // This thread's, and the compiler worker's, relayed.
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
