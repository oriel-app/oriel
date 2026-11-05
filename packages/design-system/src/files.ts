// Reading files from a checkout, for the checks and the workshop's server.
// The server's two routes take a path and a commit from the URL, so what
// they may read is narrowed here: a file inside the checkout once its links
// are followed, that git tracks or would track, or a file at a hex commit.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";

// A file in `checkout`, a real path, by repo-relative path, as a real path
// inside it once its links are followed, or null if there is none. The real
// path is the system's, in the file's own case, so `.ENV` is `.env` to git.
function inside(checkout: string, path: string): string | null {
  const full = resolve(checkout, path);
  if (!existsSync(full)) return null;
  const real = realpathSync.native(full);
  return real.startsWith(checkout + "/") && statSync(real).isFile() ? real : null;
}

// A file in the checkout, or null if there is none.
export function readIn(checkout: string, path: string): string | null {
  const real = inside(checkout, path);
  return real === null ? null : readFileSync(real, "utf8");
}

// A file the server may show: one in the checkout that git tracks, or would
// track, so nothing git ignores (.env, secrets/, .oriel/) is ever served, nor
// anything a link points at outside the checkout or at an ignored file.
export function readShown(checkout: string, path: string): string | null {
  const real = inside(checkout, path);
  if (real === null) return null;
  const relative = real.slice(checkout.length + 1);
  const listed = git(checkout, [
    "--literal-pathspecs",
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    relative,
  ]);
  return listed === `${relative}\0` ? readFileSync(real, "utf8") : null;
}

// A file as it was at a commit, by a read-only `git show`. Only a full or
// short hex commit and a plain relative path get through, so nothing git
// reads as an option, a revision range or a path outside the tree reaches it.
// Nor a path git ignores today: a `.env` committed by mistake and amended
// away still has its object.
export function readAt(checkout: string, path: string, commit: string): string | null {
  if (!/^[0-9a-f]{7,40}$/.test(commit) || !/^[\w.-]+(\/[\w.-]+)*$/.test(path)) return null;
  if (path.split("/").some((part) => part === "." || part === "..")) return null;
  if (!notIgnored(checkout, path)) return null;
  return git(checkout, ["show", `${commit}:${path}`]);
}

// `git check-ignore` exits 1 for a path no ignore rule matches, 0 for one
// that is ignored, and 128 when it can't say.
function notIgnored(checkout: string, path: string): boolean {
  try {
    execFileSync("git", ["-C", checkout, "check-ignore", "-q", "--no-index", "--", path], {
      stdio: "ignore",
    });
    return false;
  } catch (error) {
    return (error as { status?: number }).status === 1;
  }
}

function git(checkout: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", checkout, ...args], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}
