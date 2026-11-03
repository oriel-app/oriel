// Workstreams the user curates, and the regions threads work in (decision 0018).
// A workstream is a set of items from any source. Its membership is a versioned
// log: each change takes the next version, and a region is one version. Every
// thread on a workstream shares its log, so nothing is copied per thread.
import type { Actor } from "./actions.ts";
import { type Instant, type ItemId, parseItemId, type Ulid } from "./ids.ts";

// Where a workstream came from: a copy of a cluster's members at that moment (it
// doesn't follow the cluster afterwards), items the user picked, or nothing,
// made for a thread started from nothing with its first message, or for the
// window chat with its first question (decision 0027). A workstream
// made from a cluster remembers that cluster's anchor (e.g. the epic), which
// bindings bind into functions like `listStories()`. The anchor is matched by
// its stable ID, so an epic that moves projects stays the anchor.
export type WorkstreamOrigin =
  | { kind: "cluster"; grouping: string; cluster: string; anchor: WorkstreamMember | null }
  | { kind: "picked" }
  | { kind: "thread" }
  | { kind: "window" };

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

// An item's identity, whatever its handle: its source and stable ID.
export const identity = (item: { id: string; stableId: string }) =>
  `${parseItemId(item.id)?.source ?? ""}\u0000${item.stableId}`;

// The member of a workstream a handle names. Through the index, by identity, so
// an item that moved is found under its current handle; failing that, by the
// handle the member was added with, if no live item has that member's
// identity (it was deleted, or its key was reused by another item).
export function memberOf(
  handle: string,
  held: readonly WorkstreamMember[],
  records: readonly { id: string; stableId: string }[],
): WorkstreamMember | undefined {
  const record = records.find((r) => r.id === handle);
  const live = new Set(records.map(identity));
  return (
    (record && held.find((m) => identity(m) === identity(record))) ??
    held.find((m) => m.id === handle && !live.has(identity(m)))
  );
}

// What removing `members` gives back: each under the handle the index has
// for it now. One the index no longer has can't come back, so it has no
// Undo. Applying a removal and forecasting one both ask this.
export function comesBack(
  members: readonly WorkstreamMember[],
  records: readonly { id: ItemId; stableId: string }[],
): { back: ItemId[]; lost: WorkstreamMember[] } {
  const live = new Map(records.map((record) => [identity(record), record.id]));
  const back: ItemId[] = [];
  const lost: WorkstreamMember[] = [];
  for (const member of members) {
    const now = live.get(identity(member));
    if (now === undefined) lost.push(member);
    else back.push(now);
  }
  return { back, lost };
}

const keyList = new Intl.ListFormat("en-GB");

// Items by key: "SYN-3", "SYN-3 and SYN-7", "SYN-1, SYN-2 and SYN-3".
export const listKeys = (ids: readonly string[]): string =>
  keyList.format(ids.map((id) => parseItemId(id)?.key ?? id));

// Why what a removal took can't come back, in Oriel's words, the workstream
// page's: by key, or as "it" or "they" where the sentence already named them.
export function cantComeBack(ids: readonly string[], named = true): string {
  const one = ids.length === 1;
  const who = named ? `${listKeys(ids)} ${one ? "is" : "are"}` : one ? "It's" : "They're";
  return `${who} no longer in the window, so ${one ? "it" : "they"} can't come back`;
}

// What a removal's Undo gives the agent to go on, when it can't give back
// all it took: none at all, or only what comes `back`.
export function undoGap(back: readonly string[], lost: readonly string[]): string {
  const undo = back.length ? `its Undo adds back only ${listKeys(back)}` : "there's no Undo";
  return `${undo}: ${cantComeBack(lost)}`;
}

// What Oriel tells the agent of a removal it recorded, before it applies,
// when any of it can't come back; null when all of it can.
export function removalForecast(
  members: readonly WorkstreamMember[],
  records: readonly { id: ItemId; stableId: string }[],
): string | null {
  const { back, lost } = comesBack(members, records);
  if (!lost.length) return null;
  return `If this applies, ${undoGap(
    back,
    lost.map((m) => m.id),
  )}.`;
}

// One version's change to a workstream's membership, and who made it: the user,
// the agent or an outside tool, or a change set applied in one of its
// threads, which adds what it created.
export type WorkstreamChange = {
  workstreamId: Ulid;
  version: number;
  at: Instant;
  added: WorkstreamMember[];
  removed: WorkstreamMember[];
  // Who made it. `via`: the thread under whose agent's reply the user undid,
  // or did again, what the agent did, which the line there says.
  cause: Exclude<Actor, { kind: "user" }> | { kind: "user"; via?: Ulid };
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
