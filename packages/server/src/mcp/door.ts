// What the MCP door reaches of the app (decision 0024): the one dispatcher
// every door calls, Oriel's own reads, the index's search and items' live
// reads, a workstream as the window shows it, and every change a call
// publishes, as the window's streams hear it. Nothing here reaches a
// source's writer: an outside tool writes to a source only through a
// thread's change set, which a person approves.
import type { ItemId, OrielReads, Reader, Ulid } from "@oriel/core";
import type { WorkstreamView } from "@oriel/web/view";
import type { Changed, Dispatch } from "../actions.ts";

export type Outside = {
  workspaceId: Ulid;
  dispatch: Dispatch;
  reads: OrielReads;
  reader: Reader;
  // Whether the index has an item: only those are read.
  indexed(id: ItemId): boolean;
  workstream(id: Ulid): Promise<WorkstreamView | null>;
  // Calls `listener` with each change any door's call publishes, until the
  // call it gives back stops it.
  watch(listener: (changed: Changed) => void): () => void;
};
