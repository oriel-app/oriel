import type { Instant, ItemId, Ulid } from "./ids.ts";

// A region is snapshotted at creation and never follows the camera. Membership
// is by stable ID, so an item that moves projects stays in; `id` is the handle
// it had at creation. A region opened on a group remembers that group's anchor
// (e.g. the epic), which bindings bind into functions like `listStories()`.
export type Region = {
  id: Ulid;
  workspaceId: Ulid;
  items: { id: ItemId; stableId: string }[];
  origin:
    | { kind: "group"; grouping: string; cluster: string; anchor: ItemId | null }
    | { kind: "picked" };
  snapshot: number;
  createdAt: Instant;
};
