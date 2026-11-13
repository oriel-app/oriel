import type { FileHandle } from "node:fs/promises";
import type { FolderContent } from "./attrs.ts";
import { openChecked, type Refused } from "./nofollow.ts";
import { type FileEntry, maxFileBytes } from "./walk.ts";

export type FileText = Omit<FolderContent, "title">;

export type Opened = { status: "ok"; content: FolderContent } | Refused;

export async function openEntry(entry: FileEntry): Promise<Opened> {
  const checked = await openChecked(entry.path, entry);
  if (checked.status !== "open") return checked;
  const { handle, stat } = checked;
  try {
    const ok = (text: FileText): Opened => ({
      status: "ok",
      content: { title: entry.title, ...text },
    });
    if (stat.size > BigInt(maxFileBytes)) return ok(tooLarge(stat.size));
    const bytes = await readUpTo(handle, maxFileBytes + 1);
    // It grew past the cap after the walk.
    if (bytes.length > maxFileBytes) return ok(tooLarge(BigInt(bytes.length)));
    return ok(decode(bytes));
  } finally {
    await handle.close();
  }
}

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

export function tooLarge(size: bigint): FileText {
  const note = `This file is ${size} bytes, over the ${maxFileBytes}-byte limit for reading one file, so its text isn't read.`;
  return { text: note, note };
}

export const replacedNote =
  "Some of this file's bytes aren't valid UTF-8. Each invalid sequence reads as U+FFFD (�).";

export function decode(bytes: Uint8Array): FileText {
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), note: null };
  } catch {
    return { text: new TextDecoder("utf-8").decode(bytes), note: replacedNote };
  }
}
