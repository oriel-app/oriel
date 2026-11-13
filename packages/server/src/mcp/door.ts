// Nothing here reaches a source's writer: an outside tool writes to a source only through a thread's change set, which a person approves.
import type { ItemId, OrielReads, Reader, Ulid } from "@oriel/core";
import type { Changed, Dispatch } from "../actions.ts";
import type { OutsideTools } from "./tokens.ts";

export type Heard = Changed | null;

export type Outside = {
  workspaceId: Ulid;
  dispatch: Dispatch;
  reads: OrielReads;
  reader: Reader;
  indexed(id: ItemId): boolean;
  tools: OutsideTools;
  window(path: string): Promise<{ status: number; body: unknown }>;
  // Read from its source now, without keeping what it read as what the person approves against.
  diff(id: Ulid): Promise<unknown | null>;
  watch(listener: (heard: Heard) => void): () => void;
};
