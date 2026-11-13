import { homedir } from "node:os";
import { basename, isAbsolute } from "node:path";
import {
  type ConnectOf,
  type ConnectOffer,
  homeExpanded,
  object,
  refine,
  string,
} from "@oriel/core";
import { folderProblem } from "./open-connection.ts";
import { resolveFolder } from "./walk.ts";

const given = object({
  path: refine(
    string,
    (path) => path.trim() !== "" && path.length <= 1024 && !path.includes("\0"),
    "expected a folder path",
  ),
});

export const folderOptions = object({});

export const folderOffer: ConnectOffer = {
  firstRun: 2,
  mark: "F",
  title: "A folder",
  about: "Notes saved as files on this Mac, and its folders. Oriel only reads them.",
  counts: "file",
  empty: "This folder has no notes Oriel reads.",
  yours: "your notes",
  changes: "your files",
  ready: "Your notes are ready.",
  catchUp: "The folder can catch up later.",
};

export const folderReads = ({ identity }: { identity: string }): string =>
  basename(identity) || identity;

export const folderConnect = {
  steps: [
    {
      kind: "folder",
      field: "path",
      prompt: "Choose a folder of markdown files for Oriel to read.",
      what: "A folder of markdown files.",
      choose: "Choose a folder",
      another: "Choose another",
      waiting: "Waiting for the folder you choose…",
      label: "A folder of markdown files, by its path",
      placeholder: "~/notes",
      note: "Oriel reads its .md files and never changes them.",
    },
  ],
  given,
  async identify(picked) {
    const typed = picked.path.trim();
    const path = homeExpanded(typed, homedir());
    if (!isAbsolute(path))
      return { problem: "Type the folder's full path, starting with / or ~.", fields: ["path"] };
    try {
      return await resolveFolder(path);
    } catch (error) {
      const file = error instanceof Error && error.message.includes("isn't a directory");
      return {
        problem: file
          ? "That path is a file, not a folder."
          : "There's no folder Oriel can read at that path.",
        fields: ["path"],
      };
    }
  },
  make: async () => ({ options: {} }),
  failed: { open: "Oriel couldn't connect the folder.", sync: folderProblem() },
} satisfies ConnectOf<{ path: string }>;
