// No cursor: the worker sweeps for deletions only on a null cursor, and an mtime watermark
// would miss a file moved in with an older time (`mv`, unzip and sync tools keep times).
import { isAbsolute } from "node:path";
import {
  isUlid,
  itemId,
  type Log,
  parseItemId,
  type ReadResult,
  type Source,
  type Ulid,
} from "@oriel/core";
import { type FolderAttrs, type FolderContent, folderFacets, type FolderRecord } from "./attrs.ts";
import { openEntry } from "./open.ts";
import { type FileEntry, type FolderPath, walk } from "./walk.ts";

export type FolderSource = Source<"folder", FolderAttrs, FolderContent>;

export type FolderPrefix = "folder" | `folder.${number}`;

export type FolderSourceOptions = {
  folderId: Ulid;
  path: FolderPath;
  prefix?: FolderPrefix;
  log: Log;
};

export function folderSource(options: FolderSourceOptions): FolderSource {
  const { folderId, path, log } = options;
  const prefix = options.prefix ?? "folder";
  if (!isUlid(folderId)) throw new RangeError("folder: expected the folder's ID, a ULID");
  if (!isAbsolute(path)) throw new RangeError("folder: expected an absolute path");

  return {
    kind: "folder",
    prefix,

    async *sync() {
      const scope = await walk(path, folderId);
      // Throwing rather than yielding an empty page keeps the sync worker from marking all gone.
      if (scope === "missing")
        throw new Error("folder: the folder is missing or isn't a directory");
      if (scope === "forbidden")
        throw new Error("folder: the folder can't be read, or its path now leads through a link");
      if (scope.capped.length)
        log("folder: the walk stopped at a cap", {
          capped: scope.capped,
          files: scope.files.length,
        });
      const skipped = Object.entries(scope.skipped).filter(([, count]) => count > 0);
      if (skipped.length) log("folder: skipped files", Object.fromEntries(skipped));
      const texts: Record<string, string> = {};
      for (const file of scope.files) {
        if (file.tooLarge) continue;
        const opened = await openEntry(file);
        if (opened.status === "ok") texts[file.key] = opened.content.text;
      }
      yield {
        records: scope.files.map((file) => recordOf(file, prefix)),
        gone: [],
        cursor: null,
        texts,
      };
    },

    // Every call walks the whole folder, so reading items one at a time walks once per item.
    async read(ids) {
      const results = new Map<string, ReadResult<"folder", FolderContent>>();
      let pending = [...new Set(ids)];
      for (let attempt = 0; pending.length; attempt++) {
        const scope = await walk(path, folderId);
        if (typeof scope === "string") {
          const reason = scope === "missing" ? "deleted" : "forbidden";
          for (const id of pending) results.set(id, { id, status: "gone", reason });
          break;
        }
        const byKey = new Map(scope.files.map((file) => [file.key, file]));
        const retry: typeof pending = [];
        for (const id of pending) {
          const parsed = parseItemId(id);
          const key = parsed?.prefix === prefix ? parsed.key : "";
          const entry = byKey.get(key);
          const missing = scope.forbidden.has(key) ? "forbidden" : "vanished";
          const opened = entry ? await openEntry(entry) : ({ status: missing } as const);
          if (opened.status === "ok")
            results.set(id, { id, status: "ok", content: opened.content });
          else if (entry && opened.status !== "forbidden" && attempt === 0) retry.push(id);
          else
            results.set(id, {
              id,
              status: "gone",
              reason: opened.status === "vanished" ? "deleted" : "forbidden",
            });
        }
        pending = retry;
      }
      return ids.map(
        (id) => results.get(id) ?? { id, status: "gone" as const, reason: "deleted" as const },
      );
    },
  };
}

export function recordOf(file: FileEntry, prefix: FolderPrefix = "folder"): FolderRecord {
  return {
    id: itemId(prefix, file.key) as FolderRecord["id"],
    stableId: file.key,
    title: file.title,
    location: file.location,
    updatedAt: file.updatedAt,
    facets: folderFacets(),
    attrs: {},
  };
}
