// Reading one file the walk found: opened with the checks in `nofollow.ts`
// against the device and inode the walk saw, then read up to the per-file cap
// and decoded as UTF-8.
import type { FileHandle } from "node:fs/promises";
import type { FolderContent } from "./attrs.ts";
import { openChecked, type Refused } from "./nofollow.ts";
import { type FileEntry, maxFileBytes } from "./walk.ts";

export type Opened = { status: "ok"; content: FolderContent } | Refused;

// Reads the file the walk saw at `entry`. A file that is missing, swapped or
// unreadable is a status, never a throw.
export async function openEntry(entry: FileEntry): Promise<Opened> {
  const checked = await openChecked(entry.path, entry);
  if (checked.status !== "open") return checked;
  const { handle, stat } = checked;
  try {
    if (stat.size > BigInt(maxFileBytes)) return ok(tooLarge(stat.size));
    const bytes = await readUpTo(handle, maxFileBytes + 1);
    // It grew past the cap after the walk.
    if (bytes.length > maxFileBytes) return ok(tooLarge(BigInt(bytes.length)));
    return ok(decode(bytes));
  } finally {
    await handle.close();
  }
}

const ok = (content: FolderContent): Opened => ({ status: "ok", content });

async function readUpTo(handle: FileHandle, limit: number): Promise<Uint8Array> {
  const buffer = new Uint8Array(limit);
  let filled = 0;
  while (filled < limit) {
    const { bytesRead } = await handle.read(buffer, filled, limit - filled, null);
    if (bytesRead === 0) break;
    filled += bytesRead;
  }
  return buffer.subarray(0, filled);
}

// The note a file too large to read gets as its text: Oriel's words and
// numbers only.
export function tooLarge(size: bigint): FolderContent {
  const note = `This file is ${size} bytes, over the ${maxFileBytes}-byte limit for reading one file, so its text isn't read.`;
  return { text: note, note };
}

export const replacedNote =
  "Some of this file's bytes aren't valid UTF-8. Each invalid sequence reads as U+FFFD (�).";

// The file's text as UTF-8, decoded strictly. If that fails, invalid bytes are
// replaced and the content says so. A leading byte order mark is dropped.
export function decode(bytes: Uint8Array): FolderContent {
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), note: null };
  } catch {
    return { text: new TextDecoder("utf-8").decode(bytes), note: replacedNote };
  }
}
