import type { Opened, OpenVia, ToOpen } from "@oriel/core";
import { folderAttrs } from "./attrs.ts";
import { type FolderPrefix, folderSource } from "./source.ts";
import type { FolderPath } from "./walk.ts";

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
