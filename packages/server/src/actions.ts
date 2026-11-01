// The handlers of Oriel's own actions, and the one dispatcher every door
// calls (decision 0024). Core declares each action; the dispatcher checks
// its input, refuses an actor its class or doors rule out, runs it, records
// who acted, counts the call once in telemetry and publishes once to the
// window's streams. A direct action's handler gives back the call that
// undoes it, built from what actually changed. Nothing here reaches a
// source's writer: writing to a source takes an approved change set.
import {
  type ActionDeclaration,
  type ActionInput,
  type ActionName,
  actions,
  type Actor,
  type Call,
  type Cluster,
  type GroupMember,
  type GroupOrigin,
  type IndexRecord,
  type Instant,
  parseItemId,
  type TelemetryEvent,
  type Ulid,
} from "@oriel/core";
import type { GroupStore, ThreadStore } from "@oriel/db";
import { type GroupingId, isGroupingId } from "@oriel/web/view";
import { nameOf } from "./names.ts";
import type { Turns } from "./turns.ts";
import { identity, memberOf } from "./views.ts";

// What a group made for a thread from nothing is called, until a change set
// creates its epic and it takes that epic's name.
export const blankGroupName = "New group";

// A refusal the doors map: the window's routes to 400, 403 or 404.
export class ActionError extends Error {
  readonly code: "invalid" | "refused" | "not-found";
  constructor(code: ActionError["code"], message: string) {
    super(message);
    this.name = "ActionError";
    this.code = code;
  }
}

// What a call changed, for the window's streams: a group, and whether its
// members changed, which moves its working threads; or a thread, and
// whether an entry already in its chat changed, as a held message settles.
export type Changed = { group: Ulid; members: boolean } | { thread: Ulid; chat?: true };

export type ActionDeps = {
  workspaceId: Ulid;
  groups: GroupStore;
  threads: ThreadStore;
  // The index's live records, from every source.
  records(): readonly IndexRecord[];
  // A grouping's clusters as the window shows them now.
  clusters(grouping: GroupingId): Cluster[];
  // What a change set created, which joins its group before the index has it.
  created(changeSetId: Ulid): Promise<GroupMember[]>;
  // What becomes of a message held in a thread, whoever it is from.
  held: Pick<Turns, "sendHeld" | "discardHeld">;
  emit(event: TelemetryEvent): void;
  publish(changed: Changed): void;
  now(): Instant;
  newId(): Ulid;
};

type Counted = TelemetryEvent extends infer E
  ? E extends TelemetryEvent
    ? Omit<E, "at" | "workspaceId">
    : never
  : never;

// What a handler did. `events` are the SPEC §7 events that count it; with
// none, the dispatcher counts it as `action.called`.
type Outcome<O> = { output: O; undo: Call | null; changed: Changed | null; events: Counted[] };
type Handler<N extends ActionName> = (
  input: ActionInput<N>,
  actor: Actor,
  deps: ActionDeps,
) => Promise<Outcome<unknown>>;

// The user's own doing goes unsaid in an event; anyone else is named.
const by = (actor: Actor): { by?: Actor } => (actor.kind === "user" ? {} : { by: actor });

// What only the user may ask of an action, in the window: anyone else is
// refused it, whatever door they came through.
const userOnly = (actor: Actor, what: string) => {
  if (actor.kind !== "user") throw new ActionError("refused", `only the user ${what}`);
};

const mustGroup = (deps: ActionDeps, id: Ulid) => {
  const group = deps.groups.get(id);
  if (!group || group.workspaceId !== deps.workspaceId)
    throw new ActionError("not-found", "no such group");
  return group;
};

// A thread this workspace has.
const mustThread = (deps: ActionDeps, id: Ulid) => {
  const thread = deps.threads.get(id, deps.now());
  if (!thread || thread.workspaceId !== deps.workspaceId)
    throw new ActionError("not-found", "no such thread");
  return thread;
};

// Items as the index has them now. One it doesn't have is refused, unless
// the change set acting created it, as it joins before the next sync.
async function members(
  deps: ActionDeps,
  ids: readonly string[],
  actor: Actor,
): Promise<GroupMember[]> {
  const byId = new Map<string, GroupMember>(
    deps.records().map((r) => [r.id, { id: r.id, stableId: r.stableId }]),
  );
  if (actor.kind === "change-set")
    for (const member of await deps.created(actor.changeSetId)) byId.set(member.id, member);
  return ids.map((id) => {
    const member = byId.get(id);
    if (!member) throw new ActionError("invalid", `${id} isn't in the window`);
    return member;
  });
}

// What a new group is called, where it came from and what it holds: a copy
// of a cluster's members, its anchor included; picked items; or nothing.
// `size` is how many items it starts with.
async function newGroup(
  input: ActionInput<"workstream.create">,
  actor: Actor,
  deps: ActionDeps,
): Promise<{ name: string; origin: GroupOrigin; list: GroupMember[]; size: number }> {
  if (input.kind === "thread") {
    userOnly(actor, "starts a thread from nothing");
    return { name: blankGroupName, origin: { kind: "thread" }, list: [], size: 0 };
  }
  if (input.kind === "picked") {
    const list = await members(deps, input.items, actor);
    const size = new Set(list.map((m) => `${m.id}`)).size;
    return { name: input.name.trim(), origin: { kind: "picked" }, list, size };
  }
  if (!isGroupingId(input.grouping))
    throw new ActionError("invalid", "$.grouping: expected epic, assignee or stuck");
  const cluster = deps.clusters(input.grouping).find((c) => c.key === input.cluster);
  if (!cluster) throw new ActionError("not-found", "no such cluster in that grouping");
  const ids = cluster.anchor === null ? cluster.itemIds : [cluster.anchor, ...cluster.itemIds];
  const byId = new Map(deps.records().map((r) => [r.id, r]));
  const list = [...new Set(ids)].flatMap((item) => {
    const record = byId.get(item);
    return record ? [{ id: record.id, stableId: record.stableId }] : [];
  });
  const anchor = cluster.anchor === null ? null : byId.get(cluster.anchor);
  return {
    name: nameOf(cluster.label) || "Untitled",
    origin: {
      kind: "cluster",
      grouping: input.grouping,
      cluster: cluster.key,
      anchor: anchor ? { id: anchor.id, stableId: anchor.stableId } : null,
    },
    list,
    size: list.length,
  };
}

const handlers = {
  "workstream.add": async ({ workstream: id, items }, actor, deps) => {
    const group = mustGroup(deps, id);
    const change = deps.groups.add(group.id, await members(deps, items, actor), actor, deps.now());
    const added = (change?.added ?? []).map((member) => member.id);
    return {
      output: { added },
      undo: added.length
        ? { action: "workstream.remove", input: { workstream: group.id, items: added } }
        : null,
      changed: change && { group: group.id, members: true },
      events: (change?.added ?? []).map((member) => ({
        name: "group.item-added",
        groupId: group.id,
        source: parseItemId(member.id)?.source ?? "jira",
        cause: actor.kind,
      })),
    };
  },

  "workstream.remove": async ({ workstream: id, items }, actor, deps) => {
    const group = mustGroup(deps, id);
    // By identity: a moved item is removed under its current handle, and
    // one the index no longer has under the handle the group shows.
    const held = deps.groups.region(group.id, group.version)?.items ?? [];
    const records = deps.records();
    const named = items.map((item) => {
      const member = memberOf(item, held, records);
      if (!member) throw new ActionError("invalid", `${item} isn't in this group`);
      return member;
    });
    const change = deps.groups.remove(group.id, named, actor, deps.now());
    // Back under the handle the index has now; one it no longer has can't
    // come back.
    const live = new Map(records.map((record) => [identity(record), record.id]));
    const back = (change?.removed ?? []).flatMap((member) => live.get(identity(member)) ?? []);
    return {
      output: {},
      undo: back.length
        ? { action: "workstream.add", input: { workstream: group.id, items: back } }
        : null,
      changed: change && { group: group.id, members: true },
      events: [],
    };
  },

  "workstream.create": async (input, actor, deps) => {
    const { name, origin, list, size } = await newGroup(input, actor, deps);
    const id = deps.newId();
    deps.groups.create(
      { id, workspaceId: deps.workspaceId, name, origin },
      list,
      deps.now(),
      actor,
    );
    return {
      output: { workstream: id },
      undo: null,
      changed: { group: id, members: false },
      events: [{ name: "group.created", groupId: id, origin: origin.kind, size, ...by(actor) }],
    };
  },

  "workstream.rename": async ({ workstream: id, name, oriel }, actor, deps) => {
    const before = mustGroup(deps, id);
    // A change set names a group as Oriel does, never over the user's name.
    if (oriel) {
      userOnly(actor, "gives a group's name back to Oriel, by undoing a rename");
      deps.groups.giveBack(before.id, name.trim());
    } else
      deps.groups.rename(before.id, name.trim(), actor.kind === "change-set" ? "oriel" : "user");
    const after = mustGroup(deps, id);
    const renamed = after.name !== before.name || after.namedBy !== before.namedBy;
    // Back to the name it had, and to whoever gave it.
    const back = {
      workstream: before.id,
      name: before.name,
      ...(before.namedBy === "oriel" ? { oriel: true as const } : {}),
    };
    return {
      output: {},
      undo:
        renamed && before.name.trim() !== "" ? { action: "workstream.rename", input: back } : null,
      changed: renamed ? { group: before.id, members: false } : null,
      events: [],
    };
  },

  "thread.done": async ({ thread: id, via }, actor, deps) => {
    const thread = mustThread(deps, id);
    deps.threads.markDone(thread.id, deps.now(), actor);
    return {
      output: {},
      undo: null,
      changed: { thread: thread.id },
      events: [
        {
          name: "thread.marked-done",
          threadId: thread.id,
          // Only the user closes it from somewhere in the window.
          ...(actor.kind === "user" ? { via: via ?? "page" } : { by: actor }),
        },
      ],
    };
  },

  "held.send": async ({ thread: id, seq, text }, _actor, deps) => {
    const thread = mustThread(deps, id);
    const sent = deps.held.sendHeld(thread.id, seq, text);
    // A review link's holder's message is why they rejected the change set.
    const rejected = sent.from.kind === "review-link" ? { rejected: sent.from.changeSet } : {};
    return {
      output: { seq: sent.seq },
      undo: null,
      changed: { thread: thread.id, chat: true },
      events: [
        {
          name: "question.asked",
          threadId: thread.id,
          ...rejected,
          held: { from: sent.from.kind, edited: sent.edited },
        },
      ],
    };
  },

  "held.discard": async ({ thread: id, seq }, _actor, deps) => {
    const thread = mustThread(deps, id);
    const from = deps.held.discardHeld(thread.id, seq);
    return {
      output: {},
      undo: null,
      changed: { thread: thread.id, chat: true },
      events: [{ name: "held-message.discarded", threadId: thread.id, from: from.kind }],
    };
  },
} satisfies { [N in ActionName]: Handler<N> };

// Why `actor` may not call the action, or null. A review-link holder may only
// decide or dismiss the change set the link names, which no action here is
// yet. A change set acts only through what follows its apply.
export function refusal(name: ActionName, actor: Actor): string | null {
  const declared: ActionDeclaration = actions[name];
  if (actor.kind === "user") return null;
  if (actor.kind === "review-link") return `${name} isn't for a review link`;
  if (declared.class.kind === "person-only") return `${name} is the user's: ${declared.class.why}`;
  if (actor.kind === "change-set") return null;
  const closed = declared.closed?.[actor.kind === "agent" ? "agent" : "tool"];
  return closed === undefined ? null : `${name} is closed to ${actor.kind}s: ${closed}`;
}

type Output<N extends ActionName> = Awaited<ReturnType<(typeof handlers)[N]>>["output"];
type Result<N extends ActionName> = Output<N> & { undo: Call | null };
// A call site names the action and passes its own input type, so a renamed
// key fails to typecheck rather than at run time. `untyped` is the one door
// whose action is known only at run time: an Undo sent back to
// /api/actions/:name. Either way the dispatcher checks the input.
export type Dispatch = {
  <N extends ActionName>(name: N, input: ActionInput<N>, actor: Actor): Promise<Result<N>>;
  untyped(name: ActionName, input: unknown, actor: Actor): Promise<{ undo: Call | null }>;
};

// An action's input from what a request carried, checked as the dispatcher
// checks it: each field is named, so a renamed key fails to typecheck too.
export type Fields<N extends ActionName> =
  ActionInput<N> extends infer I
    ? I extends unknown
      ? { [K in keyof I]: unknown }
      : never
    : never;
export function checked<N extends ActionName>(name: N, fields: Fields<N>): ActionInput<N> {
  const declared: ActionDeclaration = actions[name];
  const decoded = declared.input(fields);
  if (!decoded.ok)
    throw new ActionError(
      "invalid",
      decoded.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "),
    );
  return decoded.value as ActionInput<N>;
}

export function dispatcher(deps: ActionDeps): Dispatch {
  const untyped = async <N extends ActionName>(
    name: N,
    raw: unknown,
    actor: Actor,
  ): Promise<Result<N>> => {
    const why = refusal(name, actor);
    if (why !== null) throw new ActionError("refused", why);
    const declared: ActionDeclaration = actions[name];
    const handler = handlers[name] as Handler<typeof name>;
    const outcome = await handler(checked(name, raw as Fields<N>), actor, deps);
    if (
      outcome.undo &&
      (declared.class.kind !== "direct" || outcome.undo.action !== declared.class.inverse)
    )
      throw new Error(`${name} gave an undo that isn't its inverse`);
    const at = deps.now();
    const { workspaceId } = deps;
    const events = outcome.events.length
      ? outcome.events
      : [{ name: "action.called" as const, action: name, by: actor }];
    for (const event of events) deps.emit({ ...event, at, workspaceId } as TelemetryEvent);
    if (outcome.changed) deps.publish(outcome.changed);
    return { ...(outcome.output as Output<typeof name>), undo: outcome.undo };
  };
  return Object.assign(
    <N extends ActionName>(name: N, input: ActionInput<N>, actor: Actor) =>
      untyped(name, input, actor),
    { untyped },
  );
}
