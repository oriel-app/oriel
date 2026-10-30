// The compiler's worker thread (see compiler.ts): one script in; tsc's pid as
// it starts, then the reply that starts the guest or why it can't start, out.
import { parentPort } from "node:worker_threads";
import { guestStart, typecheck } from "@oriel/bindings";

// `dir` is the main thread's, which removes it; `tscMs` is tsc's own timeout.
export type CompileRequest = { script: string; dts: string; tscMs: number; dir: string };
export type Started = ReturnType<typeof guestStart>;
export type WorkerMessage =
  | { kind: "spawned"; pid: number }
  | { kind: "started"; started: Started };

const post = (message: WorkerMessage) => parentPort?.postMessage(message);

async function prepare({ script, dts, tscMs, dir }: CompileRequest): Promise<Started> {
  const refused = await typecheck(script, dts, {
    timeoutMs: tscMs,
    dir,
    onSpawn: (pid) => post({ kind: "spawned", pid }),
  });
  if (refused) return { ok: false, error: refused };
  return guestStart(script);
}

parentPort?.on("message", (request: CompileRequest) => {
  void prepare(request).then(
    (started) => post({ kind: "started", started }),
    (error: unknown) =>
      post({
        kind: "started",
        started: {
          ok: false,
          error: {
            phase: "typecheck",
            message: `the script couldn't be checked: ${error instanceof Error ? error.message : String(error)}`,
            logs: [],
          },
        },
      }),
  );
});
