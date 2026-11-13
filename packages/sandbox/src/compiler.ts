// Node's stripper (SWC in WebAssembly) overflows on deep scripts and fails every later call in that isolate, so a worker that
// refused, failed or ran long is thrown away. The main thread owns tsc: terminating a worker neither kills its children nor runs its cleanup.
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import type { HostReply, Log, RunError, RunResult } from "@oriel/core";
import type { CompileRequest, WorkerMessage } from "./compile-worker.ts";
import { watchMemory } from "./memory.ts";

export type CompileJob = {
  script: string;
  dts: string;
  deadlineMs: number;
  deadlineMessage: string;
  signal: AbortSignal;
  log: Log;
  onStart: () => void;
};

export type Compiled =
  | { ok: true; reply: HostReply }
  | { ok: false; error: RunError; outcome: Exclude<RunResult["outcome"], "ok"> };

export type Compiler = { prepare(job: CompileJob): Promise<Compiled> };

// How long a retired worker gets to see its tsc die, and so reap it, before it is terminated regardless.
const graceMs = 2_000;

const kill = (pid: number) => {
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Already gone.
  }
};

// One exit hook for all of them: a synchronous kill is all `exit` allows.
const live = new Set<number>();
let hooked = false;
function track(pid: number): void {
  live.add(pid);
  if (hooked) return;
  hooked = true;
  process.on("exit", () => {
    for (const tsc of live) kill(tsc);
  });
}

const limit = (message: string, outcome: "timeout" | "limit"): Compiled => ({
  ok: false,
  error: { phase: "limit", message, logs: [] },
  outcome,
});

function refusal(error: RunError): Compiled {
  if (error.phase !== "limit") return { ok: false, error, outcome: "threw" };
  const timedOut = error.message.startsWith("the typecheck took longer than");
  return { ok: false, error, outcome: timedOut ? "timeout" : "limit" };
}

export function createCompiler(options: {
  tmpDir: string;
  maxRssBytes: number;
  memoryPollMs: number;
}): Compiler {
  let worker: Worker | null = null;
  // One job at a time, so throwing a worker away never drops another's.
  let queue: Promise<unknown> = Promise.resolve();

  const run = async (job: CompileJob): Promise<Compiled> => {
    const dir = await mkdtemp(join(options.tmpDir, "oriel-typecheck-"));
    try {
      if (job.signal.aborted) return limit("the run was aborted", "limit");
      return await inWorker(job, dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };

  const inWorker = (job: CompileJob, dir: string) =>
    new Promise<Compiled>((resolve) => {
      const current = worker ?? spawnWorker();
      worker = current;
      let tsc: number | null = null;
      let answered = false;
      let stopWatching = () => {};
      let settled = false;

      // A killed tsc is dead, so it leaves the exit hook's list at once: its
      // pid may soon belong to some other process.
      const stop = (pid: number) => {
        kill(pid);
        live.delete(pid);
      };

      const retire = async () => {
        if (worker === current) worker = null;
        if (!answered) {
          if (tsc !== null) stop(tsc);
          // Give the worker a moment to see tsc die, so the child is reaped.
          await new Promise<void>((done) => {
            const timer = setTimeout(done, graceMs);
            const finish = () => {
              clearTimeout(timer);
              done();
            };
            current.once("exit", finish);
            current.on("message", (message: WorkerMessage) => {
              // A tsc that started as the worker was retired goes too.
              if (message.kind === "spawned") stop(message.pid);
              else finish();
            });
          });
        }
        await current.terminate();
      };

      const settle = (result: Compiled, keep: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        stopWatching();
        job.signal.removeEventListener("abort", onAbort);
        // A message listener would hold the unref'd worker, and the host, open.
        current.off("message", onMessage);
        current.off("error", onError);
        current.off("exit", onExit);
        if (keep) return resolve(result);
        void retire().then(() => resolve(result));
      };

      const onMessage = (message: WorkerMessage) => {
        if (message.kind === "spawned") {
          tsc = message.pid;
          track(message.pid);
          job.log("sandbox.typecheck", { tsc_pid: message.pid });
          if (settled) return stop(message.pid);
          // tsc gets the guest's memory cap: TypeScript 7's compiler is native, so V8 heap flags don't apply, and the RSS watchdog is its only cap.
          stopWatching = watchMemory(
            message.pid,
            options.maxRssBytes,
            options.memoryPollMs,
            (bytes) =>
              settle(
                limit(`the typecheck used ${Math.round(bytes / 2 ** 20)} MB of memory`, "limit"),
                false,
              ),
          );
          return;
        }
        // The worker answers only once tsc has exited.
        answered = true;
        if (tsc !== null) live.delete(tsc);
        const { started } = message;
        settle(started.ok ? started : refusal(started.error), started.ok);
      };
      const onError = (error: Error) =>
        settle(
          {
            ok: false,
            error: {
              phase: "typecheck",
              message: `the script couldn't be checked: ${error.message}`,
              logs: [],
            },
            outcome: "threw",
          },
          false,
        );
      const onExit = () =>
        settle(
          {
            ok: false,
            error: { phase: "typecheck", message: "the script checker stopped", logs: [] },
            outcome: "threw",
          },
          false,
        );
      const onAbort = () => settle(limit("the run was aborted", "limit"), false);

      const deadline = setTimeout(
        () => settle(limit(job.deadlineMessage, "timeout"), false),
        job.deadlineMs,
      );
      current.on("message", onMessage);
      current.once("error", onError);
      current.once("exit", onExit);
      job.signal.addEventListener("abort", onAbort, { once: true });
      // tsc's own timeout ends the normal case inside the worker; the deadline
      // above is the backstop.
      const request: CompileRequest = {
        script: job.script,
        dts: job.dts,
        tscMs: Math.max(1, Math.floor((job.deadlineMs * 3) / 4)),
        dir,
      };
      current.postMessage(request);
    });

  return {
    prepare(job) {
      const turn = queue.then(async (): Promise<Compiled | null> => {
        if (job.signal.aborted) return null;
        job.onStart();
        return run(job);
      });
      queue = turn.catch(() => {});
      // The queue wait is outside the wall time, but an abort ends it at once.
      return new Promise<Compiled>((resolve, reject) => {
        const onAbort = () => reject(job.signal.reason);
        if (job.signal.aborted) return onAbort();
        job.signal.addEventListener("abort", onAbort, { once: true });
        turn.then(
          (compiled) => {
            job.signal.removeEventListener("abort", onAbort);
            if (compiled === null || job.signal.aborted) return onAbort();
            resolve(compiled);
          },
          (error: unknown) => {
            job.signal.removeEventListener("abort", onAbort);
            reject(error);
          },
        );
      });
    },
  };
}

function spawnWorker(): Worker {
  // None of the host's own flags: a worker would inherit them, and some,
  // such as `--input-type` for a host started with `-e`, make it fail.
  const worker = new Worker(new URL("./compile-worker.ts", import.meta.url), {
    // Node marks its type stripper experimental; that one warning says nothing new.
    execArgv: ["--disable-warning=ExperimentalWarning"],
  });
  worker.unref();
  return worker;
}
