// The child gets an empty environment. With `noResolve`, no `types`, an explicit file list and the script wrapped
// in a function (so a `///` line is only a comment), tsc reads the listed files and the es2024 lib, nothing else.
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunError } from "@oriel/core";
import { guestStart, wrap } from "./shim.ts";

export type Diagnostic = {
  file: string | null;
  line: number;
  column: number;
  code: number;
  text: string;
};

export type Checked =
  | { kind: "checked"; diagnostics: Diagnostic[] }
  | { kind: "limit"; message: string };

const compilerOptions = {
  strict: true,
  noEmit: true,
  target: "es2024",
  lib: ["es2024"],
  types: [],
  noResolve: true,
};

// File names are ours and have no parentheses, so a message quoting the
// script can't pass for a location.
const located = /^([^()]+)\((\d+),(\d+)\): error TS(\d+): (.*)$/;
const general = /^error TS(\d+): (.*)$/;

// `--pretty false` prints one line per diagnostic, plus indented lines for
// the rest of a message chain.
export function parseOutput(output: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const line of output.split(/\r?\n/)) {
    const at = located.exec(line);
    const anywhere = general.exec(line);
    const last = diagnostics.at(-1);
    if (at) {
      const [, file = "", row = "", column = "", code = "", text = ""] = at;
      diagnostics.push({
        file,
        line: Number(row),
        column: Number(column),
        code: Number(code),
        text,
      });
      continue;
    }
    if (anywhere) {
      const [, code = "", text = ""] = anywhere;
      diagnostics.push({ file: null, line: 0, column: 0, code: Number(code), text });
      continue;
    }
    if (last && /^\s+\S/.test(line)) last.text += `\n${line.trim()}`;
  }
  return diagnostics;
}

type TscCommand = { file: string; args: string[] };

let command: Promise<TscCommand> | undefined;

// The native compiler, run directly, so its pid is the compiler and a kill stops it. The launcher, before Node 22.15,
// spawns it as a child a kill would miss; in the desktop app this Node is Electron's, so the app carries the native package.
function tscCommand(): Promise<TscCommand> {
  command ??= (async () => {
    const manifest = fileURLToPath(import.meta.resolve("typescript/package.json"));
    const platform = `@typescript/typescript-${process.platform}-${process.arch}`;
    try {
      const native = createRequire(manifest).resolve(`${platform}/package.json`);
      const exe = join(dirname(native), "lib", process.platform === "win32" ? "tsc.exe" : "tsc");
      await access(exe, constants.X_OK);
      return { file: exe, args: [] };
    } catch {
      const { bin } = JSON.parse(await readFile(manifest, "utf8")) as { bin?: { tsc?: string } };
      if (!bin?.tsc) throw new Error("the typescript package declares no tsc bin");
      return { file: process.execPath, args: [join(dirname(manifest), bin.tsc)] };
    }
  })();
  return command;
}

// tsc stays in the caller's process group, so a Ctrl-C or a hangup that reaches the caller reaches tsc too.
export type TscControl = { dir?: string; onSpawn?: (pid: number) => void };

const maxOutput = 1 << 20;

function tsc(
  dir: string,
  options: { timeoutMs: number; signal?: AbortSignal } & TscControl,
  run: TscCommand,
): Promise<{ stdout: string; failed: boolean } | "timeout" | "overflow"> {
  return new Promise((resolve, reject) => {
    const child = spawn(run.file, [...run.args, "-p", "tsconfig.json", "--pretty", "false"], {
      cwd: dir,
      env: {},
      stdio: ["ignore", "pipe", "pipe"],
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const pid = child.pid;
    if (pid !== undefined) options.onSpawn?.(pid);
    let ended: "timeout" | "overflow" | null = null;
    let exited = false;
    const end = (why: "timeout" | "overflow") => {
      ended ??= why;
      if (pid === undefined || exited) return;
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    };
    const timer = setTimeout(() => end("timeout"), options.timeoutMs);
    const onAbort = () => end("timeout");
    options.signal?.addEventListener("abort", onAbort, { once: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > maxOutput) end("overflow");
    });
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < maxOutput) stderr += chunk;
    });
    // Once tsc is gone, a late abort or timeout must not signal its pid,
    // which the system may have given to another process.
    const done = () => {
      exited = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    };
    child.on("error", (error) => {
      done();
      if (error.name === "AbortError") return reject(error);
      reject(new Error(`tsc didn't run: ${error.message}\n${stderr}`, { cause: error }));
    });
    child.on("close", (code, signal) => {
      done();
      if (options.signal?.aborted) return;
      if (ended) return resolve(ended);
      if (code === 0) return resolve({ stdout, failed: false });
      if (code !== null) return resolve({ stdout, failed: true });
      reject(new Error(`tsc didn't run: it was stopped by ${signal}\n${stderr}`));
    });
  });
}

// Names are ours, never the agent's.
export async function compile(
  files: Readonly<Record<string, string>>,
  options: { timeoutMs: number; signal?: AbortSignal } & TscControl,
): Promise<Checked> {
  const run = await tscCommand();
  const dir = options.dir ?? (await mkdtemp(join(tmpdir(), "oriel-typecheck-")));
  try {
    const tsconfig = { compilerOptions, files: Object.keys(files) };
    await writeFile(join(dir, "tsconfig.json"), JSON.stringify(tsconfig));
    for (const [name, source] of Object.entries(files)) await writeFile(join(dir, name), source);
    const result = await tsc(dir, options, run);
    if (result === "timeout")
      return { kind: "limit", message: `the typecheck took longer than ${options.timeoutMs}ms` };
    if (result === "overflow") return { kind: "limit", message: "the typecheck printed too much" };
    const diagnostics = parseOutput(result.stdout);
    if (result.failed && !diagnostics.length)
      throw new Error(`tsc failed without diagnostics:\n${result.stdout}`);
    return { kind: "checked", diagnostics };
  } finally {
    if (options.dir === undefined) await rm(dir, { recursive: true, force: true });
  }
}

const shown = 20;

// Line breaks as tsc counts them.
const lineCount = (text: string) => text.split(/\r\n|[\n\r\u2028\u2029]/).length;

function where(d: Diagnostic, scriptLines: number): string {
  if (d.file === null) return "tsc";
  if (d.file !== "script.ts") return `${d.file} ${d.line}:${d.column}`;
  // The wrapper's first line comes before the script, and its last after.
  return `line ${Math.min(Math.max(d.line - 1, 1), scriptLines)}:${d.column}`;
}

// The script must first pass the run's own compile step, so it can't typecheck as anything but an async function's body.
// Like `guestStart`, run it off the host's main thread, in a worker replaced after any failure.
export async function typecheck(
  script: string,
  dts: string,
  options: { timeoutMs?: number; signal?: AbortSignal } & TscControl = {},
): Promise<RunError | null> {
  options.signal?.throwIfAborted();
  const start = guestStart(script);
  if (!start.ok) return start.error;
  const checked = await compile(
    { "region.d.ts": dts, "script.ts": wrap(script) },
    {
      timeoutMs: options.timeoutMs ?? 10_000,
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.dir === undefined ? {} : { dir: options.dir }),
      ...(options.onSpawn ? { onSpawn: options.onSpawn } : {}),
    },
  );
  if (checked.kind === "limit") return { phase: "limit", message: checked.message, logs: [] };
  const { diagnostics } = checked;
  if (!diagnostics.length) return null;
  const scriptLines = lineCount(script);
  const lines = diagnostics
    .slice(0, shown)
    .map((d) => `${where(d, scriptLines)}: ${d.text} (TS${d.code})`);
  if (diagnostics.length > shown) lines.push(`…and ${diagnostics.length - shown} more`);
  const count = diagnostics.length === 1 ? "1 type error" : `${diagnostics.length} type errors`;
  return {
    phase: "typecheck",
    message: `${count} in the script:\n${lines.join("\n")}`,
    hint: hintFor(dts),
    logs: [],
  };
}

function hintFor(dts: string): string {
  const makers = creators(dts);
  const refs = makers.length ? ` and refs from ${makers.join(" or ")}` : "";
  return `Fix the script against the region's declarations and run it again. Writes take only this region's IDs${refs}; search() reads outside the region.`;
}

export function creators(dts: string): string[] {
  const found: string[] = [];
  let space: string | null = null;
  for (const line of dts.split("\n")) {
    const open = /^declare const (\w+): \{$/.exec(line);
    if (open) space = open[1] ?? null;
    else if (line === "};") space = null;
    const fn = /^ {2}(\w+)\(.*\): NewRef;$/.exec(line);
    if (space && fn) found.push(`${space}.${fn[1]}`);
  }
  return found;
}
