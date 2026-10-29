// The fake bindings' guest runtime: a test fixture that speaks the same
// contract as the runtime in @oriel/bindings's shim (PR 14). JSON lines,
// calls out on stdout, replies in on stdin. Reply 0 carries the script's
// stripped body, which runs as an async function with the bindings as its
// parameters. The guest's own reads count from 1, and a create names its item
// `new:N`, counting from 1. Console output becomes log messages.
import type { NewRef } from "@oriel/core";

type Sink = { writeSync(bytes: Uint8Array): number };

type GuestDeno = {
  stdin: { readable: ReadableStream<Uint8Array> };
  stdout: Sink;
};

type Waiter = { resolve(value: unknown): void; reject(error: Error): void };

export type FakeRuntime = {
  read(fn: string, args: readonly unknown[]): Promise<unknown>;
  write(fn: string, args: readonly unknown[], creates: boolean): NewRef | null;
  start(bindings: Record<string, unknown>): void;
};

// Serialized into the shim with `toString()`: it must not close over anything
// outside its own body.
export function runtime(deno: GuestDeno, scope: { console: unknown }): FakeRuntime {
  const encoder = new TextEncoder();
  const AsyncFunction = (async () => {}).constructor as new (
    ...paramsThenBody: string[]
  ) => (...args: unknown[]) => Promise<unknown>;
  const pending = new Map<number, Waiter>();
  let reads = 0;
  let refs = 0;
  let stop = (): void => {};

  const send = (message: object): void => {
    const bytes = encoder.encode(`${JSON.stringify(message)}\n`);
    for (let at = 0; at < bytes.length;) at += deno.stdout.writeSync(bytes.subarray(at));
  };
  const show = (value: unknown): string => {
    let text: string;
    try {
      text = typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
    } catch {
      text = String(value);
    }
    return text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
  };
  const log = (...values: unknown[]): void =>
    send({ kind: "log", text: values.map(show).join(" ") });
  // Patched in place. Replacing `console` with a frozen object, as the real
  // shim does, makes Deno's node compatibility fail on every `node:` import,
  // and the escape tests are there to reach Deno's permission checks.
  Object.assign(scope.console as object, { log, info: log, warn: log, error: log, debug: log });

  const listen = (): void => {
    const reader = deno.stdin.readable.getReader();
    const decoder = new TextDecoder();
    stop = () => void reader.cancel();
    let buffer = "";
    void (async () => {
      for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
        buffer += decoder.decode(chunk.value, { stream: true });
        for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
          const reply = JSON.parse(buffer.slice(0, end));
          buffer = buffer.slice(end + 1);
          const waiter = pending.get(reply.id);
          if (!waiter) continue;
          pending.delete(reply.id);
          if (reply.ok) waiter.resolve(reply.value);
          else waiter.reject(new Error(String(reply.error)));
        }
      }
    })();
  };

  const run = async (bindings: Record<string, unknown>, body: string): Promise<void> => {
    try {
      const script = new AsyncFunction(...Object.keys(bindings), body);
      const value = await script(...Object.values(bindings));
      send({ kind: "done", value: value === undefined ? null : value });
    } catch (error) {
      const message = error instanceof Error ? String(error.stack ?? error) : String(error);
      send({ kind: "threw", message });
    }
    stop();
  };

  return {
    read(fn, args) {
      const id = ++reads;
      send({ kind: "read", id, fn, args });
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    write(fn, args, creates) {
      const ref: NewRef | null = creates ? `new:${++refs}` : null;
      send({ kind: "write", fn, args, ref });
      return ref;
    },
    start(bindings) {
      pending.set(0, {
        resolve: (body) => void run(bindings, String(body)),
        reject: (error) => send({ kind: "threw", message: error.message }),
      });
      listen();
    },
  };
}
