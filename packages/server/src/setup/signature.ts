// Before Oriel first runs the file, and whenever it changes: codesign against Apple's Developer ID and Anthropic's Team ID,
// and spctl for notarization, both by absolute path with a fixed PATH, so nothing on the person's PATH can answer for them.
import { execFile } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";

export const anthropicTeam = "Q6L2SF6YDW";

// Developer ID Application, issued under Apple's Developer ID CA, to the
// team. The leading `=` makes codesign read the text as the requirement.
export const requirement = `=anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "${anthropicTeam}"`;

export const systemPath = "/usr/bin:/bin:/usr/sbin:/sbin";

export type RunTool = (file: string, args: readonly string[]) => Promise<ToolRun>;
export type ToolRun = { code: number | null; output: string };

export const runTool: RunTool = (file, args) =>
  new Promise((resolve) => {
    execFile(
      file,
      [...args],
      { env: { PATH: systemPath }, timeout: 60_000, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === "number" ? error.code : null) : 0;
        resolve({ code, output: `${stdout}${stderr}` });
      },
    );
  });

export async function anthropicSigned(
  path: string,
  run: RunTool = runTool,
): Promise<{ problem: string; log: string[] } | null> {
  const signed = await run("/usr/bin/codesign", ["--verify", "--strict", "-R", requirement, path]);
  if (signed.code !== 0)
    return {
      problem: "It isn't signed by Anthropic, so Oriel won't run it.",
      log: [`codesign refused it (exit ${signed.code ?? "none"}): ${firstLine(signed.output)}`],
    };
  const assessed = await run("/usr/sbin/spctl", [
    "--assess",
    "--type",
    "open",
    "--context",
    "context:primary-signature",
    "--verbose",
    path,
  ]);
  if (assessed.code !== 0 || !/source=Notarized Developer ID/.test(assessed.output))
    return {
      problem: "Apple doesn't say it's notarized, so Oriel won't run it.",
      log: [`spctl refused it (exit ${assessed.code ?? "none"}): ${firstLine(assessed.output)}`],
    };
  return null;
}

const firstLine = (text: string) => text.trim().split("\n")[0]?.slice(0, 200) ?? "";

// The installer's folder last, so the CLI it installed is found even when the person's PATH lacks it.
export function withLocalBin(path: string, home: string): string {
  const bin = join(home, ".local", "bin");
  const dirs = path.split(":").filter(Boolean);
  return dirs.includes(bin) ? dirs.join(":") : [...dirs, bin].join(":");
}

export const installedVersions = (home: string): string => join(home, ".local/share/claude");

// For the file as it is now, by its path, size, time and inode. Any other CLI is the person's own.
export function installerTrust(options: {
  home: string;
  verify: (path: string) => Promise<{ problem: string } | null>;
}): (path: string) => Promise<string | null> {
  const folder = () => {
    const at = installedVersions(options.home);
    try {
      return realpathSync(at) + sep;
    } catch {
      return at + sep;
    }
  };
  const passed = new Set<string>();
  const checking = new Map<string, Promise<string | null>>();
  return async (path) => {
    let real: string;
    let print: string;
    try {
      real = realpathSync(path);
      const stat = statSync(real);
      print = `${real}\u0000${stat.size}\u0000${stat.mtimeMs}\u0000${stat.ino}`;
    } catch {
      return null;
    }
    if (!real.startsWith(folder()) || passed.has(print)) return null;
    let check = checking.get(print);
    if (!check) {
      check = options.verify(real).then(
        (refused) => {
          if (refused) return refused.problem;
          passed.add(print);
          return null;
        },
        () => "Oriel couldn't check that it's Anthropic's, so it won't run it.",
      );
      checking.set(print, check);
      void check.finally(() => checking.delete(print));
    }
    return check;
  };
}
