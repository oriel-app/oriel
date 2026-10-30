// A thread: a group, a chat and change sets (decision 0018). It is pinned to
// its group and works in one version of it, its region. Its state is derived
// from what happened in it, never stored (packages/db derives it).
import type { Instant, Ulid } from "./ids.ts";

// Working until a change set applies or the user marks it done; handed off
// when the assignee changes or an external link is attached; dropped after 7
// idle days. A new message makes any of the others working again.
export type ThreadState = "working" | "done" | "handed-off" | "dropped";

export type Thread = {
  id: Ulid;
  workspaceId: Ulid;
  groupId: Ulid;
  // A working thread moves to its group's latest version when the group
  // changes, with a marker in the chat; any other keeps its version.
  regionVersion: number;
  state: ThreadState;
  // How a done thread got there; null unless done.
  doneBy: "applied" | "marked" | null;
  createdAt: Instant;
};
