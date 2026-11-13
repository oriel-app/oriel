import type { Actor } from "./actions.ts";
import type { Instant, ItemId, Ulid } from "./ids.ts";

export type WorkstreamOrigin =
  | { kind: "cluster"; grouping: string; cluster: string; anchor: WorkstreamMember | null }
  | { kind: "picked" }
  | { kind: "thread" }
  | { kind: "window" };

export type Workstream = {
  id: Ulid;
  workspaceId: Ulid;
  name: string;
  namedBy: "user" | "oriel";
  origin: WorkstreamOrigin;
  version: number;
  createdAt: Instant;
};

export type WorkstreamMember = { id: ItemId; stableId: string };

export type WorkstreamChange = {
  workstreamId: Ulid;
  version: number;
  at: Instant;
  added: WorkstreamMember[];
  removed: WorkstreamMember[];
  cause: Exclude<Actor, { kind: "user" }> | { kind: "user"; via?: Ulid };
};

export type Region = {
  workstreamId: Ulid;
  version: number;
  workspaceId: Ulid;
  items: WorkstreamMember[];
  origin: WorkstreamOrigin;
};
