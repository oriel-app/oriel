// The pre-run typecheck: the agent's script against its region's declarations,
// by the repo's pinned `tsc`, run through the package's own `bin` on a fresh
// temporary directory. The child gets an empty environment. With `noResolve`,
// no `types`, an explicit file list and the script wrapped in a function (so
// a `///` line in it is only a comment), tsc reads the listed files and the
// es2024 lib, nothing else.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunError } from "@oriel/core";
import { wrap } from "./shim.ts";

export type Diagnostic = {
  // Null for a diagnostic about no file in particular.
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

let launcher: Promise<string> | undefined;

// The `tsc` the typescript package declares as its bin.
function tscBin(): Promise<string> {
  launcher ??= (async () => {
    const manifest = fileURLToPath(import.meta.resolve("typescript/package.json"));
    const { bin } = JSON.parse(await readFile(manifest, "utf8")) as { bin?: { tsc?: string } };
    if (!bin?.tsc) throw new Error("the typescript package declares no tsc bin");
    return join(dirname(manifest), bin.tsc);
  })();
  return launcher;
}

function tsc(
  dir: string,
  options: { timeoutMs: number; signal?: AbortSignal },
  bin: string,
): Promise<{ stdout: string; failed: boolean } | "timeout" | "overflow"> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [bin, "-p", "tsconfig.json", "--pretty", "false"],
      {
        cwd: dir,
        env: {},
        encoding: "utf8",
        timeout: options.timeoutMs,
        maxBuffer: 1 << 20,
        ...(options.signal ? { signal: options.signal } : {}),
      },
      (error, stdout, stderr) => {
        if (!error) return resolve({ stdout, failed: false });
        if (error.name === "AbortError") return reject(error);
        if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return resolve("overflow");
        if (error.killed) return resolve("timeout");
        if (typeof error.code === "number") return resolve({ stdout, failed: true });
        reject(new Error(`tsc didn't run: ${error.message}\n${stderr}`, { cause: error }));
      },
    );
  });
}

// Checks `files` (name → source) as one program. Names are ours, never the
// agent's.
export async function compile(
  files: Readonly<Record<string, string>>,
  options: { timeoutMs: number; signal?: AbortSignal },
): Promise<Checked> {
  const bin = await tscBin();
  const dir = await mkdtemp(join(tmpdir(), "oriel-typecheck-"));
  try {
    const tsconfig = { compilerOptions, files: Object.keys(files) };
    await writeFile(join(dir, "tsconfig.json"), JSON.stringify(tsconfig));
    for (const [name, source] of Object.entries(files)) await writeFile(join(dir, name), source);
    const result = await tsc(dir, options, bin);
    if (result === "timeout")
      return { kind: "limit", message: `the typecheck took longer than ${options.timeoutMs}ms` };
    if (result === "overflow") return { kind: "limit", message: "the typecheck printed too much" };
    const diagnostics = parseOutput(result.stdout);
    if (result.failed && !diagnostics.length)
      throw new Error(`tsc failed without diagnostics:\n${result.stdout}`);
    return { kind: "checked", diagnostics };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Declares what `wrap` calls, outside the agent's declarations.
const runtimeDts = "declare const __oriel: { run(body: () => Promise<unknown>): void };\n";

const shown = 20;

function where(d: Diagnostic, scriptLines: number): string {
  if (d.file === null) return "tsc";
  if (d.file !== "script.ts") return `${d.file} ${d.line}:${d.column}`;
  // The wrapper's first line comes before the script, and its last after.
  return `line ${Math.min(Math.max(d.line - 1, 1), scriptLines)}:${d.column}`;
}

// Type errors come back as a RunError the agent can fix its script from; a
// clean script gives null.
export async function typecheck(
  script: string,
  dts: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<RunError | null> {
  const checked = await compile(
    { "region.d.ts": dts, "runtime.d.ts": runtimeDts, "script.ts": wrap(script) },
    {
      timeoutMs: options.timeoutMs ?? 10_000,
      ...(options.signal ? { signal: options.signal } : {}),
    },
  );
  if (checked.kind === "limit") return { phase: "limit", message: checked.message, logs: [] };
  const { diagnostics } = checked;
  if (!diagnostics.length) return null;
  const scriptLines = script.split("\n").length;
  const lines = diagnostics
    .slice(0, shown)
    .map((d) => `${where(d, scriptLines)}: ${d.text} (TS${d.code})`);
  if (diagnostics.length > shown) lines.push(`…and ${diagnostics.length - shown} more`);
  const count = diagnostics.length === 1 ? "1 type error" : `${diagnostics.length} type errors`;
  return {
    phase: "typecheck",
    message: `${count} in the script:\n${lines.join("\n")}`,
    hint: "Fix the script against the region's declarations and run it again. Writes take only RegionId values and refs from createStory; search() reads outside the region.",
    logs: [],
  };
}
