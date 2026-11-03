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
import { execFileSync } from "node:child_process";
import { PassThrough, type Readable } from "node:stream";

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

// Every process descended from `root` in `ps -A -o pid=,ppid=`'s table,
// parents before their children, so a kill in this order leaves none behind
// to start another.
export function descendants(table: string, root: number): number[] {
  const children = new Map<number, number[]>();
  for (const row of table.split("\n")) {
    const [pid, ppid] = row.trim().split(/\s+/).map(Number);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid) || pid === ppid) continue;
    children.set(ppid!, [...(children.get(ppid!) ?? []), pid!]);
  }
  const found: number[] = [];
  const seen = new Set([root]);
  for (let at = [root]; at.length > 0;) {
    const next = at.flatMap((pid) => children.get(pid) ?? []).filter((pid) => !seen.has(pid));
    for (const pid of next) seen.add(pid);
    found.push(...next);
    at = next;
  }
  return found;
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
