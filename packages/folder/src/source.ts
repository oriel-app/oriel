// A local folder of markdown files as a source (decision 0019): read-only, so
// it has no op catalogue and no writer. `sync` walks the folder into index
// records, and `read` walks it again to find each file by its key, then opens
// it with the checks in `nofollow.ts`.
//
// No cursor. A folder has no change feed, so the only way to see a deletion
// is to walk all of it, and every sync does: the walk reads metadata only, and
// the caps bound it. So every sync is a full listing with a null cursor, and
// the sync worker's full sweep marks whatever the index has and the listing
// lacks as gone: a file deleted, renamed, turned into a link, given a second
// hard link or pushed past a cap. The index skips records that haven't
// changed, so listing them again costs no snapshot. A modification-time
// watermark would miss a file moved in with an older time (`mv`, unzip and
// sync tools keep times), and a stored copy of the last listing would be a
// second record of the folder that could disagree with the index; the worker
// sweeps only when the cursor is null, so a stored cursor it couldn't trust
// would lose deletions for good.
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

export type FolderSourceOptions = {
  // The connected folder's own ID: the ULID the workspace gave it when the
  // user picked it. Every key hashes it, so another folder gets other IDs.
  folderId: Ulid;
  // The folder's real path, from `resolveFolder` when the user picked it. A
  // walk refuses the folder if this path ever leads through a link.
  path: FolderPath;
  log: Log;
};

export function folderSource(options: FolderSourceOptions): FolderSource {
  const { folderId, path, log } = options;
  if (!isUlid(folderId)) throw new RangeError("folder: expected the folder's ID, a ULID");
  if (!isAbsolute(path)) throw new RangeError("folder: expected an absolute path");

  return {
    kind: "folder",

    // Every file, in one page: the caps keep a whole walk small enough for
    // one. Any cursor is ignored, and none is kept.
    async *sync() {
      const scope = await walk(path, folderId);
      // A folder that is missing (an unmounted drive, a renamed parent),
      // unreadable or now behind a link throws, so the sync worker marks
      // nothing gone.
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
      yield { records: scope.files.map(recordOf), gone: [], cursor: null };
    },

    // Each ID is looked up in a fresh walk and opened. A file that changed
    // between the walk and the open gets one more walk; one that changes again
    // reads as forbidden. A folder that is missing reads every ID as deleted,
    // and one that can't be read, or is now behind a link, as forbidden.
    //
    // Cost: every call walks the folder, opening each file once to check it,
    // so a script that reads items one at a time walks once per item. Near
    // the caps that is up to 10,000 metadata reads and 1,000 opens a call.
    // Keeping the last walk between calls would fix it, but that is a cache,
    // which SPEC §14 defers until one has a user.
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
          const key = parsed?.source === "folder" ? parsed.key : "";
          const entry = byKey.get(key);
          // A file the walk found but couldn't read is forbidden, not deleted.
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

// A file as the index keeps it.
export function recordOf(file: FileEntry): FolderRecord {
  return {
    id: itemId("folder", file.key),
    stableId: file.key,
    title: file.title,
    location: file.location,
    updatedAt: file.updatedAt,
    facets: folderFacets(),
    attrs: {},
  };
}
