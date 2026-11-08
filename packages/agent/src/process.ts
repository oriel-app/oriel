// A process's life, and only that (decision 0060; 0062's supervisor): a
// child in its own process group, in an empty folder made for it, or in one
// the caller lends it. Closing it, however many ask, sends SIGTERM to the
// whole group, then SIGKILL to whatever of it is left after a grace, then
// removes the folder it made; a lent folder is never removed. Oriel's own
// exit kills every group still running, as being in their own groups they'd
// outlive it. `ended` says why the child ended, from its exit, so a
// descendant holding the child's stdio open can't hide it.
//
// The tool host runs on it. Claude Code's session and Codex's app server
// move onto it later (OA-249).
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Ended = { code: number | null; signal: NodeJS.Signals | null } | { error: string };

export type Supervised = {
  child: ChildProcessWithoutNullStreams;
  // Its folder: the one made for it, or the one lent.
  dir: string;
  // Once the child has exited, or couldn't start.
  ended: Promise<Ended>;
  // Ends the whole group, then removes the folder made for it. Settles once
  // the child has exited and nothing of its group is left.
  close(): Promise<void>;
};

export type SuperviseOptions = {
  command: string;
  args: readonly string[];
  env: Record<string, string>;
  // A folder to run in, which stays; else an empty one, made and removed.
  lent?: string;
  // Between SIGTERM and SIGKILL. Default 2 s.
  graceMs?: number;
  // Closes it when aborted.
  signal?: AbortSignal;
};

// Every group still running, killed outright when Oriel exits.
const live = new Set<number>();
let listening = false;
const killAll = () => {
  for (const pid of live) signalGroup(pid, "SIGKILL");
};

const grouped = process.platform !== "win32";

// Sends `name` to a group; false when none of it is left.
function signalGroup(pid: number, name: NodeJS.Signals | 0): boolean {
  try {
    process.kill(grouped ? -pid : pid, name);
    return true;
  } catch {
    return false;
  }
}

export function supervise(options: SuperviseOptions): Supervised {
  const dir = options.lent ?? mkdtempSync(join(tmpdir(), "oriel-proc-"));
  const child = spawn(options.command, [...options.args], {
    cwd: dir,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: grouped,
  });
  const pid = child.pid;
  if (pid !== undefined) {
    live.add(pid);
    if (!listening) {
      listening = true;
      process.once("exit", killAll);
    }
  }
  // Writes to a child that's gone fail on the stream, never in the caller.
  child.stdin.on("error", () => {});
  const ended = new Promise<Ended>((resolve) => {
    child.once("error", (error) => resolve({ error: error.message }));
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  // A group that ended whole, unasked, is forgotten, so Oriel's exit never
  // signals a group ID used again since.
  void ended.then(() => {
    if (pid !== undefined && !closing && !signalGroup(pid, 0)) live.delete(pid);
  });

  const graceMs = options.graceMs ?? 2_000;
  let closing: Promise<void> | null = null;
  const close = () =>
    (closing ??= (async () => {
      child.stdin.end();
      if (pid !== undefined) {
        signalGroup(pid, "SIGTERM");
        // The group gets its grace once, whether the child ends early or
        // not: a descendant that ignores SIGTERM is killed at its end.
        let timer: ReturnType<typeof setTimeout> | undefined;
        const graceOver = new Promise<void>((resolve) => {
          timer = setTimeout(resolve, graceMs);
        });
        await Promise.race([ended, graceOver]);
        if (signalGroup(pid, 0)) {
          await graceOver;
          signalGroup(pid, "SIGKILL");
        }
        clearTimeout(timer);
        await ended;
        // Killed, a descendant is gone once its new parent reaps it, which
        // is soon but not at once.
        for (let waited = 0; waited < 2_000 && signalGroup(pid, 0); waited += 10)
          await new Promise((resolve) => setTimeout(resolve, 10));
        live.delete(pid);
      }
      if (options.lent === undefined) rmSync(dir, { recursive: true, force: true });
    })());

  const { signal } = options;
  if (signal) {
    const onAbort = () => void close();
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
    void ended.then(() => signal.removeEventListener("abort", onAbort));
  }
  return { child, dir, ended, close };
}
