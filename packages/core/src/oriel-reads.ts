// What the agent's module and the window read of Oriel's own data (decision
// 0024): the workspace's workstreams and threads, what each thread's change
// sets wrote where, and one search over them. The server builds it once;
// the agent's namespaces and the window's search route both call it. Thread names, what
// was said and what was written are the model's, the user's or the sources'
// words: they reach the agent only as tool results, never in the `.d.ts`.
import type { Instant, ItemId, Ulid } from "./ids.ts";
import type { ThreadState } from "./thread.ts";

// Where a change set stands, in the words a person uses for it: waiting on
// them, approved and not yet landed, applied (in full or in part), rejected,
// or undone by a revert that applied.
export type ChangeSetState = "pending" | "approved" | "applied" | "rejected" | "reverted";

export type WorkstreamRead = {
  id: Ulid;
  name: string;
  // Its items now, by handle.
  items: readonly ItemId[];
  // How many threads it has.
  threads: number;
};

export type ThreadRead = {
  id: Ulid;
  // The thread's title, or null before it has one.
  name: string | null;
  state: ThreadState;
  workstream: { id: Ulid; name: string };
  activityAt: Instant;
  // Opens the thread in the window.
  link: string;
};

// One change a change set made or proposes: the source it writes to, as a
// person knows it, the sentence its diff says it with, and the text it writes.
export type ChangeRead = { source: string; sentence: string; text: readonly string[] };

export type ChangeSetRead = {
  id: Ulid;
  thread: Ulid;
  state: ChangeSetState;
  createdAt: Instant;
  // When the person approved or rejected it, and who; null while pending.
  decided: { kind: "approved" | "rejected"; by: string; at: Instant } | null;
  changes: readonly ChangeRead[];
  // Opens its thread in the window, at this change set.
  link: string;
};

// Where a search matched: the thread's name, what was said in it, or what one
// of its change sets wrote.
export type MatchedIn = "name" | "chat" | "change-set";

// A thread a search found, or one of its change sets, with a few words
// around the match.
export type ThreadFound = {
  thread: ThreadRead;
  changeSet: ChangeSetRead | null;
  matched: MatchedIn;
  excerpt: string;
};

export type OrielReads = {
  // Every workstream in the workspace, newest first.
  workstreams(): Promise<WorkstreamRead[]>;
  // Every thread in the workspace, most recently active first.
  threads(): Promise<ThreadRead[]>;
  // One thread's change sets, or every thread's, newest first.
  changeSets(thread: Ulid | null): Promise<ChangeSetRead[]>;
  // Threads and change sets matching every word of `query`, best first.
  find(query: string, limit: number): Promise<ThreadFound[]>;
};

// A workspace with no threads yet, for a module built without one.
export const noThreads: OrielReads = {
  workstreams: async () => [],
  threads: async () => [],
  changeSets: async () => [],
  find: async () => [],
};

// The window's addresses for a thread, and for one of its change sets.
export const threadLink = (thread: string): string => `/threads/${thread}`;
export const changeSetLink = (thread: string, changeSet: string): string =>
  `/threads/${thread}?changeSet=${changeSet}`;
