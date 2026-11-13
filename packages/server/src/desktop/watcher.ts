// A Deno process in its own session that outlives the server: when its stdin ends the server is gone, and it kills what the
// server started that still runs (by PID and start time). Deno lets it run `/bin/ps` and `/bin/kill` and nothing else.
import { leftOver, processTable, startTime, tableColumns, toldLine } from "./processes.ts";

// As much of Deno's API as this uses. It runs on Deno, but tsc checks it
// with the server's Node types.
type Deno = {
  pid: number;
  stdin: { readable: ReadableStream<Uint8Array> };
  Command: new (
    command: string,
    options: { args: string[]; clearEnv: true; stdout: "piped" | "null"; stderr: "null" },
  ) => { output(): Promise<{ code: number; stdout: Uint8Array }> };
};
const deno = (globalThis as unknown as { Deno: Deno }).Deno;

const ps = async (args: string[]) => {
  const { stdout } = await new deno.Command("/bin/ps", {
    args,
    clearEnv: true,
    stdout: "piped",
    stderr: "null",
  }).output();
  return new TextDecoder().decode(stdout);
};

const note = (message: string, fields: Record<string, unknown> = {}) => {
  try {
    console.error(JSON.stringify({ message: `watcher: ${message}`, ...fields }));
  } catch {
    // No one is reading.
  }
};

async function* lines(input: ReadableStream<Uint8Array>) {
  let held = "";
  for await (const chunk of input.pipeThrough(new TextDecoderStream())) {
    const parts = (held + chunk).split("\n");
    held = parts.pop() ?? "";
    // A line no longer than any the server writes.
    if (held.length > 64) held = "";
    yield* parts;
  }
}

const started = new Map<number, string>();
// One at a time, in the order told, so an end never comes before its start.
let queue = Promise.resolve();
for await (const line of lines(deno.stdin.readable)) {
  const told = toldLine(line);
  if (!told) continue;
  queue = queue
    .then(async () => {
      if (told.what === "ended") return void started.delete(told.pid);
      const at = startTime(await ps(["-o", "lstart=", "-p", String(told.pid)]));
      // Gone already: nothing to kill.
      if (at) started.set(told.pid, at);
    })
    .catch((error: unknown) => note("couldn't read a start time", { error: String(error) }));
}
await queue;

const left = leftOver(started, processTable(await ps(tableColumns))).filter(
  (pid) => pid !== deno.pid,
);
if (left.length > 0) {
  await new deno.Command("/bin/kill", {
    args: ["-KILL", ...left.map(String)],
    clearEnv: true,
    stdout: "null",
    stderr: "null",
  }).output();
  note("killed what the server left running", { pids: left });
}
