// The compiler's worker thread (see compiler.ts): one script in, the reply
// that starts the guest, or why it can't start, out.
import { parentPort } from "node:worker_threads";
import { guestStart, type Started, typecheck } from "./start.ts";

export type CompileRequest = { script: string; dts: string; timeoutMs: number };

async function prepare({ script, dts, timeoutMs }: CompileRequest): Promise<Started> {
  const refused = await typecheck(script, dts, { timeoutMs });
  if (refused) return { ok: false, error: refused };
  return guestStart(script);
}

parentPort?.on("message", (request: CompileRequest) => {
  void prepare(request).then(
    (started) => parentPort?.postMessage(started),
    (error: unknown) =>
      parentPort?.postMessage({
        ok: false,
        error: {
          phase: "typecheck",
          message: `the script couldn't be checked: ${error instanceof Error ? error.message : String(error)}`,
          logs: [],
        },
      } satisfies Started),
  );
});
