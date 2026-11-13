import {
  accessSync,
  chmodSync,
  constants,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TestContext } from "node:test";
import { type Log, type SyncPage, ulid, type Ulid } from "@oriel/core";
import type { FolderAttrs } from "./attrs.ts";
import type { FolderSource } from "./source.ts";
import type { FolderPath } from "./walk.ts";

export type TempFolder = {
  root: FolderPath;
  outside: string;
  write(rel: string, body: string | Uint8Array, mtime?: string, base?: string): string;
  // False where permissions don't bind (running as root), so the test can skip.
  lock(path: string): boolean;
};

export function tempFolder(t: TestContext): TempFolder {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "oriel-folder-")));
  const locked: string[] = [];
  t.after(() => {
    for (const path of locked) chmodSync(path, 0o700);
    rmSync(top, { recursive: true, force: true });
  });
  const root = join(top, "folder") as FolderPath;
  const outside = join(top, "outside");
  mkdirSync(root);
  mkdirSync(outside);
  return {
    root,
    outside,
    write(rel, body, mtime, base = root) {
      const path = join(base, rel);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, body);
      if (mtime !== undefined) setTime(path, mtime);
      return path;
    },
    lock(path) {
      chmodSync(path, 0o000);
      locked.push(path);
      try {
        accessSync(path, constants.R_OK);
        return false;
      } catch {
        return true;
      }
    },
  };
}

export function setTime(path: string, at: string): void {
  const time = new Date(at);
  utimesSync(path, time, time);
}

export const folderA: Ulid = ulid(1_767_225_600_000, new Uint8Array(10).fill(1));
export const folderB: Ulid = ulid(1_767_225_600_000, new Uint8Array(10).fill(2));

export function keptLog(): { log: Log; lines: { message: string; fields?: unknown }[] } {
  const lines: { message: string; fields?: unknown }[] = [];
  return { log: (message, fields) => lines.push({ message, fields }), lines };
}

export async function syncPages(
  source: FolderSource,
  cursor: string | null,
): Promise<SyncPage<"folder", FolderAttrs>[]> {
  const pages: SyncPage<"folder", FolderAttrs>[] = [];
  for await (const page of source.sync(cursor)) pages.push(page);
  return pages;
}
