// Making a folder connection (decision 0049): one step, a folder, from the
// system's picker through the shell on the desktop app or a typed path under
// `pnpm dev`, read-only (decision 0019). It identifies its real path. While a
// kind opens one connection, another folder takes the place of the one
// connected: one connected before comes back under its ID and number, and
// any other is a new connection, with the next. The folder is the one
// connector the window still connects itself (decision 0059): it's on the
// person's disk, and nothing is hosted.
import { homedir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { type ConnectOf, type ConnectOffer, object, refine, string } from "@oriel/core";
import { folderProblem } from "./open-connection.ts";
import { resolveFolder } from "./walk.ts";

const given = object({
  path: refine(
    string,
    (path) => path.trim() !== "" && path.length <= 1024 && !path.includes("\0"),
    "expected a folder path",
  ),
});

// A folder has nothing to set: it reads every file under it.
export const folderOptions = object({});

// How the window offers it.
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

// What a connection reads: its name, the last part of its path.
export const folderReads = ({ identity }: { identity: string }): string =>
  basename(identity) || identity;

// The window's words for it, OA-191's and the sidebar's.
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
    const path = typed === "~" || typed.startsWith("~/") ? join(homedir(), typed.slice(1)) : typed;
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
