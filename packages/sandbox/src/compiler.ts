// The pre-run steps, `typecheck` then `guestStart`, run in a worker thread,
// never on the host's main thread. Both strip types with Node's stripper,
// SWC built as WebAssembly: a deeply nested script overflows its stack and
// leaves it failing every later call in that isolate, Node's own loading of
// `.ts` files included. So a worker that refused a script, failed or ran long
// is thrown away, and the next script gets a fresh one.
import { Worker } from "node:worker_threads";
import type { CompileRequest, Started } from "./compile-worker.ts";

export type Compiler = { prepare(request: CompileRequest): Promise<Started> };

const refused = (message: string): Started => ({
  ok: false,
  error: { phase: "typecheck", message, logs: [] },
});

export function createCompiler(): Compiler {
  let worker: Worker | null = null;
  // One script at a time, so throwing a worker away never drops another's.
  let queue: Promise<unknown> = Promise.resolve();

  const once = (request: CompileRequest) =>
    new Promise<Started>((resolve) => {
      const current = worker ?? spawn();
      worker = current;
      let settled = false;
      const done = (result: Started, keep: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        current.off("message", onMessage);
        current.off("error", onError);
        current.off("exit", onExit);
        if (!keep) {
          if (worker === current) worker = null;
          void current.terminate();
        }
        resolve(result);
      };
      const onMessage = (result: Started) => done(result, result.ok);
      const onError = (error: Error) =>
        done(refused(`the script couldn't be checked: ${error.message}`), false);
      const onExit = () => done(refused("the script checker stopped"), false);
      const timer = setTimeout(
        () => done(refused(`checking the script took over ${request.timeoutMs} ms`), false),
        request.timeoutMs,
      );
      current.on("message", onMessage);
      current.on("error", onError);
      current.on("exit", onExit);
      current.postMessage(request);
    });

  return {
    prepare(request) {
      const result = queue.then(() => once(request));
      queue = result;
      return result;
    },
  };
}

function spawn(): Worker {
  const worker = new Worker(new URL("./compile-worker.ts", import.meta.url));
  // An idle compiler doesn't keep the host alive.
  worker.unref();
  return worker;
}
