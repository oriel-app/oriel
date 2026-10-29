// The guest half of the protocol. A run's entry module is this runtime, then
// the bindings shim: trusted code only. The agent's script never becomes module
// source. The host sends it, already stripped of types, as the first line on
// stdin, a JSON string, and the runtime makes it an async function with the
// AsyncFunction constructor. Its replies to reads follow on the same stream.
//
// The shim's contract:
// - It must put the bindings on `globalThis`. The script's function runs in
//   global scope and can't see the entry module's own declarations.
// - It reaches the host only through `__oriel`, which the script can't see:
//   - `__oriel.read(fn, args)` sends a read and resolves with the host's reply;
//   - `__oriel.write(fn, args, creates)` queues a write and never waits. When
//     `creates` is true, it names the new item `new:N` and returns that ref.
//
// Nothing here is a boundary: the script shares the isolate and can write any
// line it likes. The host parses every line with `guestMessage`.
import type { NewRef } from "@oriel/core";

export type GuestApi = {
  read(fn: string, args: readonly unknown[]): Promise<unknown>;
  write(fn: string, args: readonly unknown[], creates: boolean): NewRef | null;
};

export type GuestConfig = {
  // Written to stderr before any shim or script code runs; the host times
  // the cold start by it.
  ready: string;
  // The in-guest deadline: past it the guest exits with `deadlineExit`, a
  // clean timeout. The host's kill at the wall time is the hard cap.
  deadlineMs: number;
  deadlineExit: number;
};

type Sink = { writeSync(bytes: Uint8Array): number };

// The few `Deno` members the runtime uses, captured before the script runs.
type GuestDeno = {
  stdin: { readable: ReadableStream<Uint8Array> };
  stdout: Sink;
  stderr: Sink;
  exit(code: number): never;
  inspect(value: unknown, options: { depth: number; colors: boolean }): string;
};

type GuestEvent = { preventDefault(): void; error?: unknown; reason?: unknown };

type GuestScope = {
  addEventListener(
    type: "error" | "unhandledrejection",
    listener: (event: GuestEvent) => void,
  ): void;
  console: Record<"log" | "info" | "warn" | "error" | "debug", (...args: unknown[]) => void>;
};

type Waiter = { resolve(value: unknown): void; reject(message: string): void };

// Serialized into the entry file with `toString()`: it must not close over
// anything outside its own body.
export function guest(
  deno: GuestDeno,
  scope: GuestScope,
  config: GuestConfig,
): GuestApi & { start(): void } {
  const encoder = new TextEncoder();
  const stringify = JSON.stringify;
  const parse = JSON.parse;
  const exit = deno.exit;
  const inspect = deno.inspect;
  const { stdin, stdout, stderr } = deno;
  const AsyncFunction = (async () => {}).constructor as new (
    body: string,
  ) => () => Promise<unknown>;
  const pending = new Map<number, Waiter>();
  let nextId = 1;
  let nextRef = 1;
  let finished = false;

  const writeAll = (sink: Sink, bytes: Uint8Array): void => {
    for (let at = 0; at < bytes.length;) at += sink.writeSync(bytes.subarray(at));
  };
  const sendLine = (line: string): void => writeAll(stdout, encoder.encode(`${line}\n`));
  const show = (value: unknown): string =>
    typeof value === "string" ? value : inspect(value, { depth: 4, colors: false });
  const describe = (error: unknown): string =>
    error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : show(error);
  const finish = (line: string): never => {
    if (!finished) {
      finished = true;
      sendLine(line);
    }
    return exit(0);
  };
  const threw = (error: unknown): never =>
    finish(stringify({ kind: "threw", message: describe(error) }));

  writeAll(stderr, encoder.encode(config.ready));
  setTimeout(() => exit(config.deadlineExit), config.deadlineMs);
  scope.addEventListener("error", (event) => {
    event.preventDefault();
    threw(event.error);
  });
  scope.addEventListener("unhandledrejection", (event) => {
    event.preventDefault();
    threw(event.reason);
  });
  const log = (...args: unknown[]): void =>
    sendLine(stringify({ kind: "log", text: args.map(show).join(" ") }));
  scope.console.log = log;
  scope.console.info = log;
  scope.console.warn = log;
  scope.console.error = log;
  scope.console.debug = log;

  const runScript = async (js: unknown): Promise<void> => {
    let value: unknown;
    try {
      if (typeof js !== "string") throw new TypeError("the host sent no script");
      value = await new AsyncFunction(js)();
    } catch (error) {
      return threw(error);
    }
    try {
      return finish(stringify({ kind: "done", value: value === undefined ? null : value }));
    } catch (error) {
      return threw(new TypeError(`the return value can't be sent as JSON: ${describe(error)}`));
    }
  };

  // Stdin: the script first, then replies to reads, one JSON value per line,
  // in any order.
  const listen = async (): Promise<void> => {
    const reader = stdin.readable.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    let first = true;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return;
      buffered += decoder.decode(chunk.value, { stream: true });
      for (let end = buffered.indexOf("\n"); end >= 0; end = buffered.indexOf("\n")) {
        const message = parse(buffered.slice(0, end));
        buffered = buffered.slice(end + 1);
        if (first) {
          first = false;
          void runScript(message);
          continue;
        }
        const waiter = pending.get(message.id);
        if (!waiter) continue;
        pending.delete(message.id);
        if (message.ok) waiter.resolve(message.value);
        else waiter.reject(String(message.error));
      }
    }
  };

  const read = (fn: string, args: readonly unknown[]): Promise<unknown> => {
    const id = nextId++;
    const line = stringify({ kind: "read", id, fn, args });
    // A failed read throws with the stack of the call that made it.
    const call = new Error();
    const reply = new Promise<unknown>((resolve, reject) =>
      pending.set(id, {
        resolve,
        reject(message) {
          const error = new Error(message);
          error.stack = `Error: ${message}${(call.stack ?? "").replace(/^.*/, "")}`;
          reject(error);
        },
      }),
    );
    sendLine(line);
    return reply;
  };

  const write = (fn: string, args: readonly unknown[], creates: boolean): NewRef | null => {
    const ref: NewRef | null = creates ? `new:${nextRef++}` : null;
    sendLine(stringify({ kind: "write", fn, args, ref }));
    return ref;
  };

  return Object.freeze({ read, write, start: () => void listen() });
}

// The entry module: the runtime, the shim, then the call that waits for the
// script. The script itself is never part of it.
export function entrySource(shim: string, config: GuestConfig): string {
  return [
    `const __oriel = (${guest.toString()})(Deno, globalThis, ${JSON.stringify(config)});`,
    shim,
    "__oriel.start();",
    "",
  ].join("\n");
}

// Error text from the guest, made readable for the agent: positions in the
// script become `script.ts:line:column`, positions in the entry module
// `<bindings>`, the run's directory `<sandbox>`, and terminal colors go.
export function sanitize(text: string, entry: { url: string; path: string; dir: string }): string {
  const inEntry = new RegExp(`(?:${escape(entry.url)}|${escape(entry.path)})(?::\\d+){0,2}`, "g");
  return (
    text
      .replace(colors, "")
      // A frame in the script reads "eval at <anonymous> (<entry>:5:9),
      // <anonymous>:7:3". The AsyncFunction constructor puts two lines before
      // the body.
      .replace(
        /eval at [^\n]*?, <anonymous>:(\d+):(\d+)/g,
        (_, line: string, column: string) => `script.ts:${Number(line) - 2}:${column}`,
      )
      .replace(/\bat eval \((script\.ts:\d+:\d+)\)/g, "at $1")
      .replace(inEntry, "<bindings>")
      .replaceAll(entry.dir, "<sandbox>")
  );
}

// ANSI color codes: ESC, "[", parameters, "m".
const colors = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
