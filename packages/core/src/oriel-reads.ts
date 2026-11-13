// Thread names, what was said and what was written reach the agent only as tool results, never in the `.d.ts`.
import type { Instant, ItemId, Ulid } from "./ids.ts";
import type { ThreadState } from "./thread.ts";

export const changeSetStates = ["pending", "approved", "applied", "rejected", "reverted"] as const;
export type ChangeSetState = (typeof changeSetStates)[number];

export type WorkstreamRead = {
  id: Ulid;
  name: string;
  items: readonly ItemId[];
  threads: number;
  done: boolean;
};

export type ThreadRead = {
  id: Ulid;
  name: string | null;
  state: ThreadState;
  workstream: { id: Ulid; name: string };
  activityAt: Instant;
};

export type ChangeRead = { source: string; sentence: string; text: readonly string[] };

export type ChangeSetRead = {
  id: Ulid;
  thread: Ulid;
  state: ChangeSetState;
  createdAt: Instant;
  decided: { kind: "approved" | "rejected"; by: string; at: Instant } | null;
  changes: readonly ChangeRead[];
};

export type MatchedIn = "name" | "chat" | "change-set";

export type ThreadFound = {
  thread: ThreadRead;
  changeSet: ChangeSetRead | null;
  matched: MatchedIn;
  excerpt: string;
};

export type OrielReads = {
  workstreams(): Promise<WorkstreamRead[]>;
  threads(): Promise<ThreadRead[]>;
  changeSets(thread: Ulid | null): Promise<ChangeSetRead[]>;
  find(query: string, limit: number): Promise<ThreadFound[]>;
};

export const noThreads: OrielReads = {
  workstreams: async () => [],
  threads: async () => [],
  changeSets: async () => [],
  find: async () => [],
};
