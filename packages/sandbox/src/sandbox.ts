// The sandbox host: each run is a fresh, deny-all `deno run` process that
// reaches the host only through JSON lines on stdio (decision 0006). Every
// cap is enforced here, outside the guest.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type Bindings,
  type CapturedMutation,
  type GuestMessage,
  guestMessage,
  type HostReply,
  type Log,
  type NewRef,
  type ProxiedRead,
  type RunError,
  type RunLimits,
  type RunResult,
  type Sandbox,
  type TranscriptEntry,
} from "@oriel/core";
import { scriptLineOffset } from "@oriel/bindings";
import { createCompiler } from "./compiler.ts";
import { denoArgs, denoEnv, findDeno, importMap } from "./deno.ts";
import { sanitize } from "./errors.ts";
import { watchMemory } from "./memory.ts";

export type SandboxOptions = {
  // The Deno binary. Default: the one on PATH (mise.toml pins it).
  deno?: string;
  // V8's old-space cap, in MB.
  heapMb?: number;
  // The whole process's resident memory cap, in MB, sampled every
  // `memoryPollMs` (see memory.ts). It also covers what the heap cap can't
  // see.
  maxRssMb?: number;
  memoryPollMs?: number;
  // The longest guest line the host will buffer. It is raised to fit
  // `maxResultBytes` when that is larger.
  maxLineBytes?: number;
  maxStderrBytes?: number;
  tmpDir?: string;
  // Milliseconds from an arbitrary origin; only differences are used.
  now?: () => number;
  // The host's user ID. Default: the process's.
  uid?: number;
};

// `coldStartMs`: from spawning Deno to the guest's first line, or null when
// none came. That is the cold start plus whatever the script does before its
// first read, write, log or return. The shim writes nothing at start, so the
// host can't time Deno's startup alone. Eval #6 reads it.
export type SandboxRunResult = RunResult & { coldStartMs: number | null };

type RunOptions = { limits: RunLimits; signal: AbortSignal; log: Log };

export interface DenoSandbox extends Sandbox {
  run(script: string, bindings: Bindings, options: RunOptions): Promise<SandboxRunResult>;
}

const MB = 1024 * 1024;
const logTail = 20;

const hints = {
  script: "Write a shorter script.",
  wall: "Look for a loop that never ends or a promise that never settles, and do less per run.",
  memory: "Work through items in smaller batches and keep less in memory.",
  reads: "Use the list functions to read many items at once.",
  mutations: "Propose fewer changes in one run.",
  result: "Return a summary (counts, IDs, a few fields) instead of whole items.",
  console: "Log less; return data instead of printing it.",
  stdout: "Use console.log for output and return the result; don't write to stdout directly.",
  imports: "Imports aren't available in the sandbox; use the bindings.",
};

// Guest values nested deeper than this are refused: the host's own
// JSON.stringify is recursive, and a deep enough value would overflow it.
const maxDepth = 64;

type Ending = { outcome: RunResult["outcome"]; last: TranscriptEntry };

export function createSandbox(options: SandboxOptions = {}): DenoSandbox {
  // Root ignores file modes, so the read-only location_data below would not
  // hold, and the Cache API could fill the disk.
  if ((options.uid ?? process.getuid?.()) === 0)
    throw new Error(
      "The sandbox host refuses to run as root: run it as an unprivileged user (in a container, set USER).",
    );
  const deno = options.deno ?? findDeno();
  const heapMb = options.heapMb ?? 128;
  const maxRssMb = options.maxRssMb ?? 512;
  const memoryPollMs = options.memoryPollMs ?? 50;
  const maxStderrBytes = options.maxStderrBytes ?? 64 * 1024;
  const now = options.now ?? (() => performance.now());
  const compiler = createCompiler();

  async function run(
    script: string,
    bindings: Bindings,
    { limits, signal, log }: RunOptions,
  ): Promise<SandboxRunResult> {
    signal.throwIfAborted();
    const started = now();
    // A script that is too big or doesn't compile never reaches Deno.
    const refuse = (last: TranscriptEntry, outcome: "limit" | "threw") =>
      finished(
        { reads: [], mutations: [], transcript: [last], outcome },
        now() - started,
        null,
        log,
      );
    const scriptBytes = Buffer.byteLength(script);
    if (scriptBytes > limits.maxScriptBytes) {
      const text = `the script is ${scriptBytes} bytes; the limit is ${limits.maxScriptBytes}`;
      return refuse(errorEntry("limit", text, [], hints.script), "limit");
    }
    // The typecheck, then the reply that starts the guest: in a worker, see
    // compiler.ts.
    const prepared = await compiler.prepare({
      script,
      dts: bindings.dts,
      timeoutMs: limits.wallMs,
    });
    signal.throwIfAborted();
    if (!prepared.ok) return refuse({ kind: "error", error: prepared.error }, "threw");

    const dir = await realpath(await mkdtemp(join(options.tmpDir ?? tmpdir(), "oriel-run-")));
    try {
      const work = join(dir, "work");
      await mkdir(work);
      // An addition to decision 0006 (see 0017): Cache API and localStorage
      // data, which no permission gates, would go under location_data.
      // Read-only, those writes fail instead of filling the disk. Root
      // ignores the mode, hence the uid check in createSandbox. (A read-only
      // DENO_DIR would also do it, but costs about 180 ms of cold start.)
      const denoDir = join(dir, "deno");
      await mkdir(denoDir);
      await mkdir(join(denoDir, "location_data"), { mode: 0o500 });
      // The entry file is the shim alone. The script never becomes module
      // source: it goes to the guest as data, in reply 0.
      const entryPath = join(dir, "entry.ts");
      const entryUrl = pathToFileURL(entryPath).href;
      await writeFile(entryPath, bindings.shim);
      await writeFile(join(dir, "imports.json"), importMap(entryUrl));
      const clean = (text: string) =>
        sanitize(text, { url: entryUrl, path: entryPath, dir }, scriptLineOffset);
      return await supervise({
        start: prepared.reply,
        dir,
        work,
        denoDir,
        entryPath,
        clean,
        started,
        bindings,
        limits,
        signal,
        log,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  function supervise(job: {
    start: HostReply;
    dir: string;
    work: string;
    denoDir: string;
    entryPath: string;
    clean: (text: string) => string;
    started: number;
    bindings: Bindings;
    limits: RunLimits;
    signal: AbortSignal;
    log: Log;
  }): Promise<SandboxRunResult> {
    const { bindings, limits, signal, log, clean } = job;
    return new Promise((resolve, reject) => {
      const spawnedAt = now();
      const child = spawn(
        deno,
        denoArgs({ entry: job.entryPath, importMap: join(job.dir, "imports.json"), heapMb }),
        { cwd: job.work, env: denoEnv(job.denoDir), stdio: ["pipe", "pipe", "pipe"] },
      );
      child.stdin.on("error", () => {});
      child.stdin.write(`${JSON.stringify(job.start)}\n`);

      const reads: (ProxiedRead | undefined)[] = [];
      const mutations: CapturedMutation[] = [];
      const transcript: TranscriptEntry[] = [];
      const logs: string[] = [];
      const refs = new Set<NewRef>();
      let consoleBytes = 0;
      let coldStartMs: number | null = null;
      let stderr = "";
      let stderrBytes = 0;
      let ending: Ending | "aborted" | null = null;
      let settled = false;

      const fail = (phase: RunError["phase"], message: string, hint?: string) =>
        errorEntry(phase, message, logs, hint);
      const end = (outcome: Ending["outcome"], last: TranscriptEntry) => {
        if (ending) return;
        ending = { outcome, last };
        child.kill("SIGKILL");
      };
      // An addition to decision 0006 (see 0017): there is no in-guest
      // deadline. The host kills the process at the wall-time cap and reports
      // it itself, as a clean "limit" error that names the cap.
      const wall = setTimeout(
        () =>
          end(
            "timeout",
            fail(
              "limit",
              `the run passed its wall time of ${limits.wallMs} ms and was stopped`,
              hints.wall,
            ),
          ),
        limits.wallMs,
      );
      const stopWatching =
        child.pid === undefined
          ? () => {}
          : watchMemory(child.pid, maxRssMb * MB, memoryPollMs, (bytes) =>
              end(
                "limit",
                fail(
                  "limit",
                  `the run used ${Math.round(bytes / MB)} MB of memory; the limit is ${maxRssMb} MB`,
                  hints.memory,
                ),
              ),
            );
      const onAbort = () => {
        if (ending) return;
        ending = "aborted";
        child.kill("SIGKILL");
      };
      signal.addEventListener("abort", onAbort, { once: true });
      // Aborted while the entry file was being written.
      if (signal.aborted) onAbort();

      const proxyRead = async (id: number, fn: string, args: unknown[]) => {
        const slot = reads.push(undefined) - 1;
        const startedRead = now();
        let reply: string;
        try {
          const { value, outsideRegion } = await bindings.read(fn, args);
          const payload = JSON.stringify(value) ?? "null";
          const read = {
            fn,
            args,
            ms: now() - startedRead,
            outsideRegion,
            payloadHash: sha256(payload),
          };
          if (!settled) reads[slot] = read;
          log("sandbox.read", {
            fn,
            args,
            ms: read.ms,
            outside_region: outsideRegion,
            payload_hash: read.payloadHash,
          });
          reply = `{"id":${id},"ok":true,"value":${payload}}`;
        } catch (error) {
          const message = errorText(error);
          log("sandbox.read", { fn, args, ms: now() - startedRead, error: message });
          reply = JSON.stringify({ id, ok: false, error: message });
        }
        if (!ending) child.stdin.write(`${reply}\n`);
      };

      const handle = (message: GuestMessage) => {
        switch (message.kind) {
          case "read":
            if (reads.length >= limits.maxReads) {
              end(
                "limit",
                fail("limit", `the script made more than ${limits.maxReads} reads`, hints.reads),
              );
              return;
            }
            void proxyRead(message.id, message.fn, message.args).catch((error: unknown) =>
              end("threw", fail("runtime", `the host failed a read: ${errorText(error)}`)),
            );
            return;
          case "write": {
            if (mutations.length >= limits.maxMutations) {
              const text = `the script captured more than ${limits.maxMutations} mutations`;
              end("limit", fail("limit", text, hints.mutations));
              return;
            }
            const { fn, args, ref } = message;
            if (ref !== null && refs.has(ref)) {
              end("threw", fail("runtime", `${fn}: ${ref} was already created in this run`));
              return;
            }
            try {
              mutations.push(bindings.capture(fn, args, ref));
            } catch (error) {
              end("threw", fail("runtime", `${fn} was refused: ${errorText(error)}`));
              return;
            }
            if (ref !== null) refs.add(ref);
            return;
          }
          case "log": {
            // Its newline counts too, so even empty lines run into the cap.
            const bytes = Buffer.byteLength(message.text) + 1;
            if (consoleBytes + bytes > limits.maxConsoleBytes) {
              const text = `console output passed ${limits.maxConsoleBytes} bytes`;
              end("limit", fail("limit", text, hints.console));
              return;
            }
            consoleBytes += bytes;
            logs.push(message.text);
            transcript.push({ kind: "log", text: message.text });
            return;
          }
          case "done": {
            const value = message.value === undefined ? null : message.value;
            const bytes = Buffer.byteLength(JSON.stringify(value));
            if (bytes > limits.maxResultBytes) {
              const text = `the return value is ${bytes} bytes; the limit is ${limits.maxResultBytes}`;
              end("limit", fail("limit", text, hints.result));
              return;
            }
            end("ok", { kind: "return", value });
            return;
          }
          case "threw":
            end(
              "threw",
              fail(
                "runtime",
                clean(message.message),
                message.message.includes('"no-imports"') ? hints.imports : undefined,
              ),
            );
        }
      };

      const malformed = (detail: string) =>
        end(
          "threw",
          fail(
            "runtime",
            `the script wrote a line to stdout that isn't a sandbox message: ${detail}`,
            hints.stdout,
          ),
        );

      const handleLine = (bytes: Buffer) => {
        let raw: unknown;
        try {
          raw = JSON.parse(bytes.toString("utf8"));
        } catch {
          malformed("it isn't JSON");
          return;
        }
        if (nestsDeeper(raw, maxDepth)) {
          malformed(`it nests deeper than ${maxDepth} levels`);
          return;
        }
        const parsed = guestMessage(raw);
        if (parsed.ok) {
          handle(parsed.value);
          return;
        }
        const kind =
          typeof raw === "object" && raw !== null && "kind" in raw ? raw.kind : undefined;
        malformed(
          typeof kind === "string"
            ? `a ${JSON.stringify(kind).slice(0, 40)} message with the wrong shape`
            : "it has no known kind",
        );
      };
      // Runs inside a stream listener, where a throw would take the host down.
      const onLine = (bytes: Buffer) => {
        try {
          handleLine(bytes);
        } catch (error) {
          end("threw", fail("runtime", `the host couldn't handle a line: ${errorText(error)}`));
        }
      };

      const lineCap = Math.max(options.maxLineBytes ?? MB, limits.maxResultBytes + 1024);
      const lines = splitLines(lineCap, onLine, () =>
        end(
          "limit",
          fail("limit", `a line from the script was over ${lineCap} bytes`, hints.stdout),
        ),
      );
      child.stdout.on("data", (chunk: Buffer) => {
        coldStartMs ??= now() - spawnedAt;
        if (!ending) lines.push(chunk, () => ending !== null);
      });

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderrBytes += Buffer.byteLength(chunk);
        if (stderrBytes > maxStderrBytes) {
          const text = `the script wrote more than ${maxStderrBytes} bytes to stderr`;
          end("limit", fail("limit", text, hints.console));
          return;
        }
        stderr += chunk;
      });

      // A guest that ended on its own without `done` or `threw`: out of
      // memory, or a runtime error, whatever its exit code.
      const exited = (code: number | null, killedBy: NodeJS.Signals | null): Ending => {
        const text = clean(stderr.trim());
        if (/out of memory|reached heap limit/i.test(stderr)) {
          const message = `the script ran out of memory (the heap limit is ${heapMb} MB)`;
          return { outcome: "limit", last: fail("limit", message, hints.memory) };
        }
        const how = code === null ? `signal ${killedBy}` : `exit code ${code}`;
        const message = `the script stopped before returning (${how})${text ? `:\n${text}` : ""}`;
        return { outcome: "threw", last: fail("runtime", message) };
      };

      const settle = () => {
        settled = true;
        clearTimeout(wall);
        stopWatching();
        signal.removeEventListener("abort", onAbort);
      };

      child.on("error", (error) => {
        if (settled) return;
        settle();
        reject(error);
      });

      child.on("close", (code, killedBy) => {
        if (settled) return;
        if (ending === null && lines.pending() > 0) malformed("its last line has no newline");
        settle();
        if (ending === "aborted") {
          reject(signal.reason);
          return;
        }
        const { outcome, last } = ending ?? exited(code, killedBy);
        transcript.push(last);
        const result = {
          reads: reads.filter((read) => read !== undefined),
          mutations,
          transcript,
          outcome,
        };
        resolve(finished(result, now() - job.started, coldStartMs, log));
      });
    });
  }

  return { run };
}

function finished(
  result: Omit<RunResult, "wallMs">,
  wallMs: number,
  coldStartMs: number | null,
  log: Log,
): SandboxRunResult {
  log("sandbox.run", {
    outcome: result.outcome,
    wall_ms: wallMs,
    cold_start_ms: coldStartMs,
    reads: result.reads.length,
    mutations: result.mutations.length,
  });
  return { ...result, wallMs, coldStartMs };
}

function errorEntry(
  phase: RunError["phase"],
  message: string,
  logs: readonly string[],
  hint?: string,
): TranscriptEntry {
  const error: RunError = { phase, message, logs: logs.slice(-logTail) };
  if (hint !== undefined) error.hint = hint;
  return { kind: "error", error };
}

// Splits a byte stream on "\n" without ever buffering more than `cap` bytes of
// one line.
function splitLines(cap: number, onLine: (line: Buffer) => void, oversize: () => void) {
  let parts: Buffer[] = [];
  let size = 0;
  return {
    push(chunk: Buffer, stop: () => boolean) {
      let start = 0;
      for (let end = chunk.indexOf(10); end >= 0; end = chunk.indexOf(10, start)) {
        const piece = chunk.subarray(start, end);
        if (size + piece.length > cap) return oversize();
        parts.push(piece);
        const line = Buffer.concat(parts, size + piece.length);
        parts = [];
        size = 0;
        start = end + 1;
        onLine(line);
        if (stop()) return;
      }
      const rest = chunk.subarray(start);
      parts.push(rest);
      size += rest.length;
      if (size > cap) oversize();
    },
    pending: () => size,
  };
}

// Whether arrays and objects in `value` nest deeper than `max`. Iterative, so
// a hostile value can't overflow the stack here either.
function nestsDeeper(value: unknown, max: number): boolean {
  const stack: [unknown, number][] = [[value, 0]];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    const [item, depth] = next;
    if (typeof item !== "object" || item === null) continue;
    if (depth >= max) return true;
    for (const child of Object.values(item)) stack.push([child, depth + 1]);
  }
  return false;
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
