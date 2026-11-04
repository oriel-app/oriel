// A folder connection, opened (decision 0049): read-only, so it has no
// namespace and no writer. Its identity is the real path its pick resolved
// to, which every walk checks again, and every key hashes its connection's
// ID, so the same folder connected again gives the same IDs.
import type { Opened, OpenVia, ToOpen } from "@oriel/core";
import { folderAttrs } from "./attrs.ts";
import { type FolderPrefix, folderSource } from "./source.ts";
import type { FolderPath } from "./walk.ts";

// A sync that failed: a folder that can't be read now, such as one on an
// unmounted drive, leaves its items as they were.
export const folderProblem = () => "Oriel couldn't read the folder just now. Is it still there?";

export async function openFolder(connection: ToOpen, via: OpenVia): Promise<Opened> {
  const path = connection.identity as FolderPath;
  return {
    source: folderSource({
      folderId: connection.id,
      path,
      prefix: connection.prefix as FolderPrefix,
      log: via.log,
    }),
    attrs: folderAttrs,
    about: path,
    scope: undefined,
    context: () => undefined,
    problem: folderProblem,
  };
}
