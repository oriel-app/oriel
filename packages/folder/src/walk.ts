// The walk (decision 0019): which files in the folder the user picked are
// items, and what each one's ID is. It reads listings and metadata; contents
// are read later, one file at a time, by `open.ts`.
//
// - Scope: `.md` files only. Dotfiles, dot-directories and `node_modules` are
//   skipped by name, before anything looks at them.
// - Containment: the folder is kept as its real path when the user picks it
//   (`resolveFolder`), and a walk refuses it if that path now leads through a
//   link. Every other path is that path plus names the walk listed, checked
//   to stay inside it. A link below it is never followed, whether it points at
//   a file or a directory, inside the folder or out, and a file with more than
//   one hard link is skipped, since its other name may be anywhere. Before a
//   file is listed, it is opened as a read would open it (`nofollow.ts`), so
//   a listing raced through a link can't name a file outside the folder.
// - Identity: an item's key is a hash of the folder's own ID and the file's
//   canonical relative path, so no name a person wrote reaches an ID. The name
//   is the title, which is data.
// - Caps: the walk stops at a depth, an entry count, a file count and a total
//   size, so a folder like a home directory can't flood the index.
import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { lstat, opendir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { type Instant, instant, type Ulid } from "@oriel/core";
import { isMissing, isSystemFailure, openChecked } from "./nofollow.ts";

// How many directories deep below the folder the walk goes. A note in
// area/project/year/quarter/topic/ is five deep; deeper trees are almost
// always generated, archived or vendored.
export const maxDepth = 6;
// How many directory entries of any kind the walk looks at, skipped ones
// included. The file cap below counts only markdown, so without this a folder
// with few notes and much else (a home directory, a code checkout) would be
// walked to the end. Ten thousand metadata reads take well under a second.
export const maxEntries = 10_000;
// How many markdown files become items. More than a person curates by hand,
// few enough that the window stays a list someone can read and one sync is
// one page.
export const maxFiles = 1_000;
// The largest file whose text is read: 512 KiB, about 128k tokens of
// English, already most of a model's context. A note someone wrote is a few
// KiB; a bigger file is an export or generated. It is still listed, and reads
// as a note saying it's too large.
export const maxFileBytes = 512 * 1024;
// The most text the folder's items may hold in total: 32 MiB, so every read a
// run can make stays bounded however many files there are. Files over the
// per-file cap don't count, since their text is never read.
export const maxTotalBytes = 32 * 1024 * 1024;

export type Cap = "depth" | "entries" | "files" | "bytes";

// One file the walk found in scope.
export type FileEntry = {
  // 16 hex digits: the item's key, and its stable ID.
  key: string;
  // Relative to the folder: NFC, forward slashes, the case the directory
  // listed. What the key hashes.
  canonical: string;
  // Absolute: the folder's path and the names as listed, unnormalized, so it
  // opens the file the walk saw.
  path: string;
  // The file's name without `.md`, in NFC. Data, like any source content.
  title: string;
  location: string;
  updatedAt: Instant;
  size: number;
  // Over `maxFileBytes`: listed, but its text is never read.
  tooLarge: boolean;
  // Who the file was when the walk opened it. A read checks the descriptor
  // against these, so a file swapped in since is refused.
  dev: bigint;
  ino: bigint;
};

export type Skipped = {
  // Links, to files or directories, inside the folder or out.
  links: number;
  // Files with more than one hard link.
  hardLinks: number;
  // Files whose canonical paths are the same, such as two names that differ
  // only in Unicode normalization. Neither can own the ID, so both are left
  // out rather than one silently standing in for the other.
  ambiguous: number;
  // Names the system couldn't decode as UTF-8. Two of them can decode to the
  // same text, so neither can be told apart or opened reliably.
  undecodable: number;
  // Directories and files Oriel may not or can't read: not permitted, a path
  // too long for the system, a loop of links.
  unreadable: number;
};

export type Walk = {
  // In walk order: breadth first, each directory's names in code-unit order,
  // so the file and size caps cut in the same place every time. (Where the
  // entry cap cuts a directory, which of its names were looked at depends on
  // the order the system lists them.)
  files: FileEntry[];
  // Keys of markdown files the walk found but couldn't read, so a read of one
  // says forbidden rather than deleted. Files in a directory it couldn't list
  // aren't known by name, so aren't here.
  forbidden: Set<string>;
  capped: Cap[];
  skipped: Skipped;
};

// Why there is no walk: the folder is gone or isn't a directory, or Oriel
// may not read it, or its path now leads through a link.
export type Unavailable = "missing" | "forbidden";

// A folder's real path, as `resolveFolder` returns it. The source takes only
// this, so a path the user typed or picked can't reach it unresolved.
export type FolderPath = string & { readonly __brand: "FolderPath" };

// The path to keep for a folder the user picks: its real path, which every
// walk then requires it still to be. Throws when it isn't a directory.
export async function resolveFolder(picked: string): Promise<FolderPath> {
  const real = await realpath(picked);
  if (!(await lstat(real)).isDirectory())
    throw new Error("folder: the picked path isn't a directory");
  return real as FolderPath;
}

// The key for a file: 16 hex digits of a SHA-256 over the folder's ID and the
// file's canonical relative path, with a NUL between, which neither can hold.
export function folderKey(folderId: Ulid, canonical: string): string {
  return createHash("sha256")
    .update(folderId)
    .update("\u0000")
    .update(canonical)
    .digest("hex")
    .slice(0, 16);
}

// A file's path inside the folder as the key hashes it: each name in NFC,
// joined with forward slashes, in the case the directory listed.
export function canonicalPath(names: readonly string[]): string {
  return names.map((name) => name.normalize("NFC")).join("/");
}

// The first and last instants with a four-digit year, so times stay canonical
// and sort as strings. A file can claim any modification time.
const earliest = 0;
const latest = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

// A modification time in milliseconds as a canonical instant: whole
// milliseconds, clamped into years 1970 to 9999.
export function canonicalTime(ms: number): Instant {
  const whole = Number.isFinite(ms) ? Math.trunc(ms) : earliest;
  return instant(new Date(Math.min(Math.max(whole, earliest), latest)));
}

// What a name decodes to where its bytes weren't UTF-8.
const replacement = String.fromCodePoint(0xfffd);

// Names the walk never looks at: dotfiles and dot-directories (`.env`,
// `.git`), `node_modules`, and names that didn't decode.
export function skipsName(name: string): boolean {
  return name.startsWith(".") || name === "node_modules" || name.includes(replacement);
}

const isMarkdown = (name: string) => name.length > 3 && name.slice(-3).toLowerCase() === ".md";

// Whether `path` is strictly inside `root`, once resolved.
function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== "" && !isAbsolute(rel) && rel.split(sep)[0] !== "..";
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// What a listing or a metadata read gets when the thing is gone, or can't be
// read for a reason of its own. A failure of the system (out of descriptors,
// an I/O error) throws: the sync then fails and marks nothing gone, rather
// than taking an unread directory for an empty one.
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

// Up to `budget` names in a directory, read lazily so a huge directory costs
// no more than the budget.
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

// Opens a file as a read would, expecting what `lstat` saw, and returns what
// its descriptor says. An editor that saved by replacing the file in between
// gets one more look.
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

// Walks the folder at `root`, which must be its own real path. Entries that
// vanish mid-walk are skipped, and so are ones Oriel may not read.
export async function walk(root: FolderPath, folderId: Ulid): Promise<Walk | Unavailable> {
  let real: string;
  try {
    real = await realpath(root);
  } catch (error) {
    return unread(error) === "missing" ? "missing" : "forbidden";
  }
  // The folder was kept as its real path when it was picked. If the path now
  // leads through a link, someone pointed it elsewhere.
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
    // The folder itself must list; a directory below it may have vanished,
    // or be one Oriel may not read.
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

// The files whose keys no other file shares. Equal canonical paths give equal
// keys; so would a hash collision, which is handled the same way.
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
