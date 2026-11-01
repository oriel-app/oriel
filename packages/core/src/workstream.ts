// Workstreams the user curates, and the regions threads work in (decision 0018).
// A workstream is a set of items from any source. Its membership is a versioned
// log: each change takes the next version, and a region is one version. Every
// thread on a workstream shares its log, so nothing is copied per thread.
import type { Actor } from "./actions.ts";
import type { Instant, ItemId, Ulid } from "./ids.ts";

// Where a workstream came from: a copy of a cluster's members at that moment (it
// doesn't follow the cluster afterwards), items the user picked, or nothing,
// made for a thread started from nothing with its first message. A workstream
// made from a cluster remembers that cluster's anchor (e.g. the epic), which
// bindings bind into functions like `listStories()`. The anchor is matched by
// its stable ID, so an epic that moves projects stays the anchor.
export type WorkstreamOrigin =
  | { kind: "cluster"; grouping: string; cluster: string; anchor: WorkstreamMember | null }
  | { kind: "picked" }
  | { kind: "thread" };

export type Workstream = {
  id: Ulid;
  workspaceId: Ulid;
  name: string;
  // Who named it: Oriel, which names every workstream it makes and may name it
  // again (a cluster's workstream follows its anchor's title), or the user, whose
  // name Oriel never changes.
  namedBy: "user" | "oriel";
  origin: WorkstreamOrigin;
  // The latest version of its membership.
  version: number;
  createdAt: Instant;
};

// A member is identified by its source and stable ID, so an item that moves
// (an issue to another project) stays in; `id` is the handle it had when
// it was added.
export type WorkstreamMember = { id: ItemId; stableId: string };

// One version's change to a workstream's membership, and who made it: the user,
// the agent or an outside tool, or a change set applied in one of its
// threads, which adds what it created.
export type WorkstreamChange = {
  workstreamId: Ulid;
  version: number;
  at: Instant;
  added: WorkstreamMember[];
  removed: WorkstreamMember[];
  cause: Actor;
};

// One version of a workstream's membership: what a thread works in, what a run
// records, and what bindings and the `.d.ts` are built from. Moving around the
// window never changes it. A version whose members don't include the origin's
// anchor has none; one that does names the anchor by that member's handle.
export type Region = {
  workstreamId: Ulid;
  version: number;
  workspaceId: Ulid;
  items: WorkstreamMember[];
  origin: WorkstreamOrigin;
};
