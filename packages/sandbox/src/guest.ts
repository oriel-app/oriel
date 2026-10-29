// The guest half of the protocol. Each run's entry file is this runtime, then
// the bindings shim, then the agent's script as the body of an async function,
// so the script can `await` reads and `return` its result.
//
// The shim's contract: it runs after the runtime and reaches the host only
// through `__oriel`:
// - `__oriel.read(fn, args)` sends a read and resolves with the host's reply;
// - `__oriel.write(fn, args, creates)` queues a write and never waits. When
//   `creates` is true it names the new item `new:N` and returns that ref.
//
// Nothing here is a boundary: the agent's script shares the isolate and can
// forge any line. The host parses every line with `guestMessage`.
import type { NewRef } from "@oriel/core";

export type GuestApi = {
  read(fn: string, args: readonly unknown[]): Promise<unknown>;
  write(fn: string, args: readonly unknown[], creates: boolean): NewRef | null;
  main(body: () => Promise<unknown>): Promise<void>;
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

// The few `Deno` members the runtime uses, captured before the script can
// replace them.
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
export function guest(deno: GuestDeno, scope: GuestScope, config: GuestConfig): GuestApi {
  const encoder = new TextEncoder();
  const stringify = JSON.stringify;
  const parse = JSON.parse;
  const exit = deno.exit;
  const inspect = deno.inspect;
  const { stdin, stdout, stderr } = deno;
  const pending = new Map<number, Waiter>();
  let nextId = 1;
  let nextRef = 1;
  let listening = false;
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

  // Replies come back on stdin, one JSON object per line, in any order.
  const listen = async (): Promise<void> => {
    const reader = stdin.readable.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return;
      buffered += decoder.decode(chunk.value, { stream: true });
      for (let end = buffered.indexOf("\n"); end >= 0; end = buffered.indexOf("\n")) {
        const reply = parse(buffered.slice(0, end));
        buffered = buffered.slice(end + 1);
        const waiter = pending.get(reply.id);
        if (!waiter) continue;
        pending.delete(reply.id);
        if (reply.ok) waiter.resolve(reply.value);
        else waiter.reject(String(reply.error));
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
    if (!listening) {
      listening = true;
      void listen();
    }
    return reply;
  };

  const write = (fn: string, args: readonly unknown[], creates: boolean): NewRef | null => {
    const ref: NewRef | null = creates ? `new:${nextRef++}` : null;
    sendLine(stringify({ kind: "write", fn, args, ref }));
    return ref;
  };

  const main = async (body: () => Promise<unknown>): Promise<void> => {
    let value: unknown;
    try {
      value = await body();
    } catch (error) {
      return threw(error);
    }
    try {
      return finish(stringify({ kind: "done", value: value === undefined ? null : value }));
    } catch (error) {
      return threw(new TypeError(`the return value can't be sent as JSON: ${describe(error)}`));
    }
  };

  return Object.freeze({ read, write, main });
}

// The entry file, and the line the script starts on, for mapping positions in
// errors back to the script.
export function entrySource(
  shim: string,
  script: string,
  config: GuestConfig,
): { source: string; scriptLine: number } {
  const head = [
    `const __oriel = (${guest.toString()})(Deno, globalThis, ${JSON.stringify(config)});`,
    shim,
    "await __oriel.main(async () => {",
    "",
  ].join("\n");
  return { source: `${head}${script}\n});\n`, scriptLine: head.split("\n").length };
}

// Rewrites positions in the entry file to the agent's script (`script.ts`) or,
// outside it, to `<bindings>`, so errors point at lines the agent wrote.
// Also drops terminal colours and the run's temporary paths.
export function sanitize(
  text: string,
  entry: { url: string; path: string; dir: string },
  scriptLine: number,
): string {
  const position = new RegExp(
    `(?:${escape(entry.url)}|${escape(entry.path)}):(\\d+)(?::(\\d+))?`,
    "g",
  );
  return (
    text
      .replace(colours, "")
      .replace(position, (_, line: string, column: string | undefined) => {
        const at = Number(line) - scriptLine + 1;
        const where = at >= 1 ? `script.ts:${at}` : "<bindings>";
        return column === undefined || at < 1 ? where : `${where}:${column}`;
      })
      // Code frames: "121 | const = 2;", padded so the caret line still lines up.
      .replace(/^( *)(\d+) \|/gm, (frame, pad: string, line: string) => {
        const at = Number(line) - scriptLine + 1;
        return at >= 1 ? `${String(at).padStart(pad.length + line.length)} |` : frame;
      })
      .replaceAll(entry.url, "script.ts")
      .replaceAll(entry.path, "script.ts")
      .replaceAll(entry.dir, "<sandbox>")
  );
}

// ANSI colour codes: ESC, "[", parameters, "m".
const colours = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
