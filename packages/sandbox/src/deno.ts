// How a run's Deno process is started (decision 0006).
import { execFileSync } from "node:child_process";
import { accessSync, constants, realpathSync } from "node:fs";
import { basename, delimiter, join } from "node:path";

// No `--allow-*` anywhere: everything not listed is denied too, and
// `--no-prompt` makes a permission check throw instead of asking.
export const denyAll = [
  "--no-prompt",
  "--no-remote",
  "--no-npm",
  "--no-config",
  "--deny-net",
  "--deny-read",
  "--deny-write",
  "--deny-env",
  "--deny-run",
  "--deny-ffi",
  "--deny-sys",
  "--deny-import",
] as const;

export function denoArgs(run: { entry: string; importMap: string; heapMb: number }): string[] {
  return [
    "run",
    ...denyAll,
    `--import-map=${run.importMap}`,
    `--v8-flags=--max-old-space-size=${run.heapMb}`,
    run.entry,
  ];
}

// `--deny-read` doesn't cover the module graph: Deno loads every import whose
// specifier is a literal, static or dynamic, before the script runs and
// without asking for read permission. A literal `import("/any/file.json", {
// with: { type: "json" } })` would read any JSON file on the machine. This map
// sends every `file:` specifier but the entry's own to a scheme Deno refuses.
export function importMap(entryUrl: string): string {
  return JSON.stringify({ imports: { "file:///": "no-imports:/", [entryUrl]: entryUrl } });
}

// The child's whole environment. Deno's update check would otherwise call the
// network from the CLI itself (not the guest) once per fresh `DENO_DIR`.
export function denoEnv(denoDir: string): Record<string, string> {
  return { DENO_DIR: denoDir, DENO_NO_UPDATE_CHECK: "1" };
}

// The real Deno binary on PATH. A mise shim is resolved through mise, since a
// shim run with an empty environment can't find its config.
export function findDeno(path: string = process.env.PATH ?? ""): string {
  for (const dir of path.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, "deno");
    let real: string;
    try {
      accessSync(candidate, constants.X_OK);
      real = realpathSync(candidate);
    } catch {
      continue;
    }
    if (basename(real) === "mise") return miseWhich(real);
    return real;
  }
  throw new Error(
    "Deno isn't on PATH. mise.toml pins it: run `mise install`, then `mise exec -- <command>`.",
  );
}

function miseWhich(mise: string): string {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => key === "PATH" || key === "HOME" || /^(MISE|XDG)_/.test(key),
    ),
  );
  return execFileSync(mise, ["which", "deno"], { encoding: "utf8", env }).trim();
}
