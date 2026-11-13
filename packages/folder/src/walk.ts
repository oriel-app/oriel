// A file with more than one hard link is skipped, since its other name may be anywhere.
import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { lstat, opendir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { type Instant, instant, type Ulid } from "@oriel/core";
import { isMissing, isSystemFailure, openChecked } from "./nofollow.ts";

export const maxDepth = 6;
// The file cap counts only markdown, so without this a folder with few notes and much else
// (a home directory, a code checkout) would be walked to the end.
export const maxEntries = 10_000;
export const maxFiles = 1_000;
export const maxFileBytes = 512 * 1024;
export const maxTotalBytes = 32 * 1024 * 1024;

export type Cap = "depth" | "entries" | "files" | "bytes";

export type FileEntry = {
  key: string;
  canonical: string;
  // Unnormalized, as listed, so it opens the file the walk saw.
  path: string;
  title: string;
  location: string;
  updatedAt: Instant;
  size: number;
  tooLarge: boolean;
  dev: bigint;
  ino: bigint;
};

export type Skipped = {
  links: number;
  hardLinks: number;
  ambiguous: number;
  undecodable: number;
  unreadable: number;
};

export type Walk = {
  // Sorted, so the file and size caps cut in the same place every time; an entry cap within a
  // directory still depends on the order the system lists it.
  files: FileEntry[];
  forbidden: Set<string>;
  capped: Cap[];
  skipped: Skipped;
};

export type Unavailable = "missing" | "forbidden";

// Branded so a path the user typed or picked can't reach the source unresolved.
export type FolderPath = string & { readonly __brand: "FolderPath" };

export async function resolveFolder(picked: string): Promise<FolderPath> {
  const real = await realpath(picked);
  if (!(await lstat(real)).isDirectory())
    throw new Error("folder: the picked path isn't a directory");
  return real as FolderPath;
}

// A NUL between the ID and the path, which neither can hold, keeps the pair unambiguous.
export function folderKey(folderId: Ulid, canonical: string): string {
  return createHash("sha256")
    .update(folderId)
    .update("\u0000")
    .update(canonical)
    .digest("hex")
    .slice(0, 16);
}

export function canonicalPath(names: readonly string[]): string {
  return names.map((name) => name.normalize("NFC")).join("/");
}

// A file can claim any modification time; four-digit years keep instants canonical and
// sortable as strings.
const earliest = 0;
const latest = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

export function canonicalTime(ms: number): Instant {
  const whole = Number.isFinite(ms) ? Math.trunc(ms) : earliest;
  return instant(new Date(Math.min(Math.max(whole, earliest), latest)));
}

const replacement = String.fromCodePoint(0xfffd);

export function skipsName(name: string): boolean {
  return name.startsWith(".") || name === "node_modules" || name.includes(replacement);
}

const isMarkdown = (name: string) => name.length > 3 && name.slice(-3).toLowerCase() === ".md";

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== "" && !isAbsolute(rel) && rel.split(sep)[0] !== "..";
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// A failure of the system throws, so the sync marks nothing gone rather than taking an
// unread directory for an empty one.
type Unread = "missing" | "unreadable";

function unread(error: unknown): Unread {
  if (isSystemFailure(error)) throw error;
  return isMissing(error) ? "missing" : "unreadable";
}

async function statOf(path: string): Promise<BigIntStats | Unread> {
  try {
    return await lstat(path, { bigint: true });
  } catch (error) {
    return unread(error);
  }
}

async function list(dir: string, budget: number): Promise<string[] | Unread> {
  const names: string[] = [];
  try {
    // The iterator closes the directory when the loop ends, however it ends.
    for await (const entry of await opendir(dir)) {
      if (names.length >= budget) break;
      names.push(entry.name);
    }
  } catch (error) {
    return unread(error);
  }
  return names;
}

async function checkedStat(path: string, seen: BigIntStats): Promise<BigIntStats | Unread> {
  for (let expected = seen, attempt = 0; ; attempt++) {
    const checked = await openChecked(path, expected);
    if (checked.status === "open") {
      await checked.handle.close();
      return checked.stat;
    }
    if (checked.status === "forbidden") return "unreadable";
    if (checked.status === "vanished" || attempt > 0) return "missing";
    const again = await statOf(path);
    if (typeof again === "string" || !again.isFile() || again.nlink !== 1n) return "missing";
    expected = again;
  }
}

export async function walk(root: FolderPath, folderId: Ulid): Promise<Walk | Unavailable> {
  let real: string;
  try {
    real = await realpath(root);
  } catch (error) {
    return unread(error) === "missing" ? "missing" : "forbidden";
  }
  // The folder was kept as its real path, so a different one now means a link points elsewhere.
  if (real !== root) return "forbidden";
  const top = await statOf(root);
  if (top === "unreadable") return "forbidden";
  if (top === "missing" || !top.isDirectory()) return "missing";

  const files: FileEntry[] = [];
  const forbidden = new Set<string>();
  const capped = new Set<Cap>();
  const skipped: Skipped = { links: 0, hardLinks: 0, ambiguous: 0, undecodable: 0, unreadable: 0 };
  let entries = 0;
  let bytes = 0;
  const queue = [{ path: root as string, names: [] as string[], dev: top.dev, ino: top.ino }];

  walking: for (let dir = queue.shift(); dir; dir = queue.shift()) {
    const isRoot = dir.path === root;
    if (entries >= maxEntries) {
      capped.add("entries");
      break;
    }
    const listed = await list(dir.path, maxEntries - entries + 1);
    if (typeof listed === "string") {
      if (isRoot) return listed === "missing" ? "missing" : "forbidden";
      if (listed === "unreadable") skipped.unreadable++;
      continue;
    }
    if (listed.length > maxEntries - entries) {
      capped.add("entries");
      listed.length = maxEntries - entries;
    }
    entries += listed.length;
    // The directory must still be the one the walk entered. One swapped for a
    // link while it was listed would have listed somewhere else.
    const again = await statOf(dir.path);
    const same =
      typeof again !== "string" &&
      again.isDirectory() &&
      again.dev === dir.dev &&
      again.ino === dir.ino;
    if (!same && isRoot) return "forbidden";
    if (!same) continue;

    const names = listed.toSorted(byCodeUnit).filter((name) => {
      if (name.includes(replacement) && !name.startsWith(".")) skipped.undecodable++;
      return !skipsName(name);
    });
    const paths = names.map((name) => join(dir.path, name));
    const stats = await Promise.all(paths.map(statOf));
    for (const [i, name] of names.entries()) {
      const path = paths[i];
      const stat = stats[i];
      if (path === undefined || stat === undefined || !inside(root, path)) continue;
      const keyOf = () => folderKey(folderId, canonicalPath([...dir.names, name]));
      if (typeof stat === "string") {
        if (stat === "unreadable") {
          skipped.unreadable++;
          if (isMarkdown(name)) forbidden.add(keyOf());
        }
        continue;
      }
      if (stat.isSymbolicLink()) {
        skipped.links++;
        continue;
      }
      if (stat.isDirectory()) {
        if (dir.names.length + 1 > maxDepth) capped.add("depth");
        else queue.push({ path, names: [...dir.names, name], dev: stat.dev, ino: stat.ino });
        continue;
      }
      if (!stat.isFile() || !isMarkdown(name)) continue;
      if (stat.nlink !== 1n) {
        skipped.hardLinks++;
        continue;
      }
      if (files.length >= maxFiles) {
        capped.add("files");
        break walking;
      }
      const opened = await checkedStat(path, stat);
      if (typeof opened === "string") {
        if (opened === "unreadable") {
          skipped.unreadable++;
          forbidden.add(keyOf());
        }
        continue;
      }
      const size = Number(opened.size);
      const tooLarge = size > maxFileBytes;
      if (!tooLarge && bytes + size > maxTotalBytes) {
        capped.add("bytes");
        break walking;
      }
      if (!tooLarge) bytes += size;
      const canonical = canonicalPath([...dir.names, name]);
      files.push({
        key: folderKey(folderId, canonical),
        canonical,
        path,
        title: name.normalize("NFC").slice(0, -3),
        location: pathToFileURL(path).href,
        updatedAt: canonicalTime(Number(opened.mtimeMs)),
        size,
        tooLarge,
        dev: opened.dev,
        ino: opened.ino,
      });
    }
  }
  return { files: unambiguous(files, skipped), forbidden, capped: [...capped], skipped };
}

export function unambiguous<F extends { key: string }>(
  files: readonly F[],
  skipped: Pick<Skipped, "ambiguous">,
): F[] {
  const counts = new Map<string, number>();
  for (const file of files) counts.set(file.key, (counts.get(file.key) ?? 0) + 1);
  return files.filter((file) => {
    if (counts.get(file.key) === 1) return true;
    skipped.ambiguous++;
    return false;
  });
}
