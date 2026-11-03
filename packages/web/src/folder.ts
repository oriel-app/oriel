// The connected folder: connecting one by its typed path (there is no
// native picker on localhost), from the sidebar's sources, in place of the
// one before. Syncing it is the sidebar's, as for every source.
import { type Effect, errorOf, get, post, type Replied } from "./http.ts";
import type { FolderView } from "./view.ts";

export type FolderModel = {
  // The connected folder, null before one is, or before it has loaded.
  view: FolderView | null;
  // Whether the form for a path is open.
  open: boolean;
  path: string;
  pending: boolean;
  problem: string | null;
};

export type FolderMsg =
  | { type: "opened" }
  | { type: "closed" }
  | { type: "pathChanged"; path: string }
  | { type: "connectClicked" };

export const loadFolder: Effect = get("/api/folder", { kind: "folder" });

export function initFolder(): FolderModel {
  return { view: null, open: false, path: "", pending: false, problem: null };
}

export function updateFolder(model: FolderModel, msg: FolderMsg): [FolderModel, Effect[]] {
  switch (msg.type) {
    case "opened":
      return [{ ...model, open: true, problem: null }, []];
    case "closed":
      return [{ ...model, open: false, problem: null }, []];
    case "pathChanged":
      return [{ ...model, path: msg.path }, []];
    case "connectClicked": {
      const path = model.path.trim();
      if (path === "" || model.pending) return [model, []];
      return [
        { ...model, pending: true, problem: null },
        [post("/api/folder", { path }, { kind: "folderConnected" })],
      ];
    }
  }
}

// A reply about the folder. `synced` says the index changed, so the window
// should load again.
export function folderReplied(
  model: FolderModel,
  msg: Replied,
): { model: FolderModel; synced: boolean } {
  const { tag } = msg;
  if (tag.kind === "folder")
    return {
      model: msg.ok
        ? { ...model, view: (msg.body as { folder: FolderView | null }).folder }
        : model,
      synced: false,
    };
  if (tag.kind !== "folderConnected") return { model, synced: false };
  if (!msg.ok)
    return { model: { ...model, pending: false, problem: errorOf(msg.body) }, synced: false };
  const { folder } = msg.body as { folder: FolderView };
  return {
    model: { ...model, view: folder, pending: false, open: false, path: "", problem: null },
    synced: true,
  };
}
