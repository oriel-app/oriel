// What the MCP door reaches of the app (decision 0024): the one dispatcher
// every door calls, Oriel's own reads, the index's search and items' live
// reads, the window's own read routes, the tools the person connected, and
// every change the window's streams carry. Nothing here reaches a source's
// writer: an outside tool writes to a source only through a thread's
// change set, which a person approves.
import type { ItemId, OrielReads, Reader, Ulid } from "@oriel/core";
import type { Changed, Dispatch } from "../actions.ts";
import type { OutsideTools } from "./tokens.ts";

// What the window's streams carry: a change one of Oriel's actions made, or
// a thread that moved in a turn (`{ thread }`), or the workspace as a whole,
// as after a sync (null).
export type Heard = Changed | null;

export type Outside = {
  workspaceId: Ulid;
  dispatch: Dispatch;
  reads: OrielReads;
  reader: Reader;
  // Whether the index has an item: only those are read.
  indexed(id: ItemId): boolean;
  // The tools the person connected, and what each called.
  tools: OutsideTools;
  // One of the window's read routes (reads.ts), a GET, answered as the
  // window's page is: its status, and its JSON. `path` is under /api.
  window(path: string): Promise<{ status: number; body: unknown }>;
  // A change set's diff as the window shows it, read from its source now,
  // without keeping what it read as what the person approves against; null
  // when there's none.
  diff(id: Ulid): Promise<unknown | null>;
  // Calls `listener` with everything the window's streams carry, until the
  // call it gives back stops it.
  watch(listener: (heard: Heard) => void): () => void;
};
