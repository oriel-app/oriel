// The connected folder: connecting one from the sidebar's sources, in place
// of the one before, with the system's folder picker on the desktop app
// (OA-184), or by its typed path under `pnpm dev`, which has none. Syncing
// it is the sidebar's, as for every source.
import { type Effect, errorOf, get, post, type Replied } from "./http.ts";
import type { ConnectionsView, ConnectionView, FolderView } from "./view.ts";

export type FolderModel = {
  // The connected folder, null before one is, or before it has loaded.
  view: FolderView | null;
  // Whether the form for a path is open.
  open: boolean;
  // Whether the server offers the system's folder picker.
  picker: boolean;
  path: string;
  pending: boolean;
  problem: string | null;
};

export type FolderMsg =
  | { type: "opened" }
  | { type: "closed" }
  | { type: "pathChanged"; path: string }
  | { type: "connectClicked" }
  | { type: "pickClicked" };

export const loadFolder: Effect = get("/api/connections", { kind: "folder" });

// The folder as its connection has it, until one component draws every
// connector's steps (OA-216).
const folderOf = (connection: ConnectionView): FolderView => ({
  path: connection.identity,
  items: connection.items,
  syncedAt: connection.syncedAt,
});

export function initFolder(): FolderModel {
  return { view: null, open: false, picker: false, path: "", pending: false, problem: null };
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
        [
          post(
            "/api/connections",
            { kind: "folder", given: { path } },
            { kind: "folderConnected" },
          ),
        ],
      ];
    }
    case "pickClicked":
      if (model.pending) return [model, []];
      return [
        { ...model, pending: true, problem: null },
        [post("/api/connections/picker", { kind: "folder" }, { kind: "folderPicked" })],
      ];
  }
}

// A reply about the folder. `synced` says the index changed, so the window
// should load again.
export function folderReplied(
  model: FolderModel,
  msg: Replied,
): { model: FolderModel; synced: boolean } {
  const { tag } = msg;
  if (tag.kind === "folder") {
    if (!msg.ok) return { model, synced: false };
    const body = msg.body as ConnectionsView;
    const open = body.connections.find((each) => each.kind === "folder" && each.state === "open");
    return {
      model: { ...model, view: open ? folderOf(open) : null, picker: body.picker },
      synced: false,
    };
  }
  if (tag.kind !== "folderConnected" && tag.kind !== "folderPicked")
    return { model, synced: false };
  if (!msg.ok)
    return { model: { ...model, pending: false, problem: errorOf(msg.body) }, synced: false };
  const body = msg.body as { connection: ConnectionView; picked?: true } | { picked: false };
  // Cancelled in the picker: nothing changed.
  if (!("connection" in body)) return { model: { ...model, pending: false }, synced: false };
  return {
    model: {
      ...model,
      view: folderOf(body.connection),
      pending: false,
      open: false,
      path: "",
      problem: null,
    },
    synced: true,
  };
}
