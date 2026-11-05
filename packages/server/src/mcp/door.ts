// What the MCP door reaches of the app (decision 0024): the one dispatcher
// every door calls, Oriel's own reads, the index's search and items' live
// reads, a workstream as the window shows it, and every change a call
// publishes, as the window's streams hear it. Nothing here reaches a
// source's writer: an outside tool writes to a source only through a
// thread's change set, which a person approves.
import type { Actor, ItemId, OrielReads, Reader, Thread, Ulid } from "@oriel/core";
import type { Message } from "@oriel/db";
import type { WorkstreamView } from "@oriel/web/view";
import type { Changed, Dispatch } from "../actions.ts";
import type { ThreadEvent } from "../turns.ts";
import type { OutsideTools } from "./tokens.ts";

export type Outside = {
  workspaceId: Ulid;
  // The tools the user connected, which the dispatcher asks whether one is
  // trusted.
  tools: OutsideTools;
  dispatch: Dispatch;
  reads: OrielReads;
  reader: Reader;
  // Whether the index has an item: only those are read.
  indexed(id: ItemId): boolean;
  workstream(id: Ulid): Promise<WorkstreamView | null>;
  // Calls `listener` with each change any door's call publishes, until the
  // call it gives back stops it.
  watch(listener: (changed: Changed) => void): () => void;
  // A thread's chat as stored, and who started the turn running in it, if
  // one is; null for a thread the workspace doesn't have.
  chat(id: Ulid): { thread: Thread; messages: readonly Message[]; turn: Actor | null } | null;
  // Calls `listener` with each event of the thread's (a chat entry, a turn
  // starting or ending, a change set changing), until the call it gives
  // back stops it.
  watchThread(id: Ulid, listener: (event: ThreadEvent) => void): () => void;
};
