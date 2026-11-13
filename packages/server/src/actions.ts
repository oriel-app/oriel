// Nothing here reaches a source's writer: writing to a source takes an approved change set.
// A stand-in's item changes through its connection's own edit, never a writer, and only by the person's hand.
import {
  type ActionDeclaration,
  type ActionInput,
  type ActionName,
  actions,
  alternatives,
  type Actor,
  type Approver,
  type Call,
  type ChangeSet,
  type ChangeSets,
  type Cluster,
  type Draft,
  type Workstream,
  type WorkstreamChange,
  type WorkstreamMember,
  type WorkstreamOrigin,
  type IndexRecord,
  clusterMembers,
  type Instant,
  type ItemId,
  maxAbout,
  maxReasonChars,
  parseItemId,
  type TelemetryEvent,
  type Ulid,
} from "@oriel/core";
import { sendLeaseMs } from "@oriel/changeset";
import type { Held, Move, WorkstreamStore, ThreadStore } from "@oriel/db";
import { type ConnectionView, type GroupingId, isGroupingId } from "@oriel/web/view";
import { nameOf } from "./names.ts";
import type { NoticedService } from "./noticed.ts";
import { ThreadBusy, type Turns } from "./turns.ts";
import { clippedTitle, identity, memberOf } from "./views.ts";

export const blankWorkstreamName = "New workstream";
export const windowChatName = "Window chat";

export class ActionError extends Error {
  readonly code: "invalid" | "refused" | "not-found" | "conflict";
  constructor(code: ActionError["code"], message: string) {
    super(message);
    this.name = "ActionError";
    this.code = code;
  }
}

export type Changed =
  | { workstream: Ulid; members: boolean }
  | { workstream: Ulid; deleted: readonly Ulid[] }
  | { thread: Ulid; chat?: true; moved?: Move }
  | { thread: Ulid; deleted: true }
  | { thread: Ulid; changeSet: Ulid; applying: boolean };

export type SourceOutcome =
  | { connection: ConnectionView }
  | { problem: string; fields?: readonly string[] };

export const isChangeSetError = (error: unknown): error is Error & { code: string } =>
  error instanceof Error && error.name === "ChangeSetError" && "code" in error;

export type ActionDeps = {
  workspaceId: Ulid;
  workstreams: WorkstreamStore;
  threads: ThreadStore;
  records(): readonly IndexRecord[];
  clusters(grouping: GroupingId): Cluster[];
  created(changeSetId: Ulid): Promise<WorkstreamMember[]>;
  turns: Pick<
    Turns,
    | "say"
    | "retry"
    | "rejected"
    | "unrejected"
    | "stop"
    | "sendHeld"
    | "discardHeld"
    | "carry"
    | "continued"
  >;
  changeSets: ChangeSets;
  secondLook?: {
    take(changeSetId: Ulid): Promise<void>;
    add(changeSetId: Ulid, look: Ulid, places: readonly number[]): Promise<ChangeSet>;
    dismiss(changeSetId: Ulid, look: Ulid): void;
  };
  applied(set: ChangeSet): Promise<void>;
  edit(
    item: ItemId,
    values: Readonly<Record<string, unknown>>,
  ): Promise<{ before: Record<string, unknown>; after: Record<string, unknown> }>;
  sources: {
    connect(
      input: ActionInput<"source.connect">,
    ): Promise<{ outcome: SourceOutcome; counted: boolean }>;
    configure(input: ActionInput<"source.configure">): Promise<{
      outcome: SourceOutcome | { connection: ConnectionView; problem?: string };
      changed: readonly string[];
      replaced: Record<string, unknown>;
    }>;
    sync(
      input: ActionInput<"source.sync">,
    ): Promise<{ outcome: SourceOutcome; of: Pick<ConnectionView, "kind" | "number"> }>;
    disconnect(
      input: ActionInput<"source.disconnect">,
    ): Promise<Pick<ConnectionView, "id" | "kind" | "number">>;
  };
  kinds: {
    on(kind: string, server: string | undefined): Promise<{ server: string | null }>;
    off(kind: string, by: "person" | "agent"): Promise<{ server: string | null }>;
    dismiss(): void;
  };
  drafted(draft: Draft): { over: unknown; name: string } | null;
  settle?(draft: Draft): Promise<Record<string, unknown>>;
  holding?(item: ItemId): { id: Ulid; name: string } | null;
  running(threadId: Ulid): boolean;
  unsettled(threadId: Ulid): Promise<{ waits: boolean; names: readonly ItemId[] }[]>;
  markSeen(at: Instant, seq: number): void;
  noticed?: () => NoticedService;
  later(ms: number, then: () => void): () => void;
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

// `counted` when what it called counts it, as the change set engine and a turn do, so nothing is counted twice.
type Outcome<O> = {
  output: O;
  undo: Call | null;
  changed: Changed | null;
  events: Counted[] | "counted";
};

type Handler<N extends ActionName> = (
  input: ActionInput<N>,
  actor: Actor,
  deps: ActionDeps,
  cause: WorkstreamChange["cause"],
) => Promise<Outcome<unknown>>;

const by = (actor: Actor): { by?: Actor } => (actor.kind === "user" ? {} : { by: actor });

// Anyone else is refused, whatever door they came through.
const userOnly = (actor: Actor, what: string) => {
  if (actor.kind !== "user") throw new ActionError("refused", `only the user ${what}`);
};

const bound = (actor: Actor) => actor.kind === "agent" || actor.kind === "tool";
const ownThread = (actor: Actor) => (actor.kind === "agent" ? actor.threadId : null);
const keys = (ids: readonly string[]) => ids.map((id) => parseItemId(id)?.key ?? id).join(", ");

const mustWorkstream = (deps: ActionDeps, id: Ulid) => {
  const workstream = deps.workstreams.get(id);
  if (!workstream || workstream.workspaceId !== deps.workspaceId)
    throw new ActionError("not-found", "no such workstream");
  return workstream;
};

const mustThread = (deps: ActionDeps, id: Ulid) => {
  const thread = deps.threads.get(id, deps.now());
  if (!thread || thread.workspaceId !== deps.workspaceId)
    throw new ActionError("not-found", "no such thread");
  return thread;
};

// One of a deleted thread, kept for what it wrote, is gone with it.
export const liveChangeSet = async (
  deps: Pick<ActionDeps, "changeSets" | "threads" | "workspaceId" | "now">,
  id: Ulid,
): Promise<ChangeSet | null> => {
  const set = await deps.changeSets.get(id);
  return set && set.workspaceId === deps.workspaceId && deps.threads.get(set.threadId, deps.now())
    ? set
    : null;
};
const mustChangeSet = async (deps: ActionDeps, id: Ulid) => {
  const set = await liveChangeSet(deps, id);
  if (!set) throw new ActionError("not-found", "no such change set");
  return set;
};

// A review link's holder presents its token, which the engine checks.
const approverOf = (actor: Actor, token: string | undefined): Approver => {
  if (actor.kind === "review-link" && token !== undefined)
    return { via: "review-link", token, by: actor.by };
  if (actor.kind === "user" && token === undefined) return { via: "thread", by: "user" };
  throw new ActionError("invalid", "only a review link's holder gives its token, and they must");
};

// The engine marks it applying before `apply` returns its promise, so the first reload sees that.
// A send may go unanswered past its lease with no word from the source, so it looks again then, and each minute after.
const applyTold = async (deps: ActionDeps, set: ChangeSet) => {
  const applying = deps.changeSets.apply(set.id);
  const told = (applying: boolean) =>
    deps.publish({ thread: set.threadId, changeSet: set.id, applying });
  told(true);
  let stalled = false;
  const look = () => {
    if (deps.changeSets.stalled(set.id) !== stalled) {
      stalled = !stalled;
      told(true);
      if (stalled)
        deps.emit({
          name: "changeset.stalled",
          changeSetId: set.id,
          threadId: set.threadId,
          at: deps.now(),
          workspaceId: deps.workspaceId,
        });
    }
    cancel = deps.later(lookAgainMs, look);
  };
  let cancel = deps.later(sendLeaseMs, look);
  let report: Awaited<typeof applying>;
  try {
    report = await applying;
  } finally {
    cancel();
    told(false);
  }
  await deps.applied(await mustChangeSet(deps, set.id));
  return report;
};

const lookAgainMs = 60_000;

const stale = (deps: ActionDeps, held: { draft: Draft; over: unknown }): boolean => {
  const now = deps.drafted(held.draft);
  return now === null || JSON.stringify(now.over) !== JSON.stringify(held.over);
};

const fixedFields = (action: ActionName): string[] =>
  alternatives(action).flatMap((shape) =>
    Object.entries(shape.fields).flatMap(([key, field]) =>
      field.kind === "refined" && field.type?.endsWith("Id") ? [key] : [],
    ),
  );

async function waitsOn(
  deps: ActionDeps,
  threadId: Ulid,
  settles: (held: Held) => boolean = () => false,
): Promise<string | null> {
  if ((await deps.unsettled(threadId)).some((set) => set.waits))
    return "a change set in it waits on you";
  const held = deps.threads.held(threadId).filter((each) => !settles(each));
  if (held.some((each) => "from" in each)) return "a message held in it waits on you";
  if (held.length > 0) return "a draft of the agent's in it waits on you";
  return null;
}

// One the index doesn't have is refused, unless the change set acting created it, as it joins before the next sync.
async function members(
  deps: ActionDeps,
  ids: readonly string[],
  actor: Actor,
): Promise<WorkstreamMember[]> {
  const byId = new Map<string, WorkstreamMember>(
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

async function newWorkstream(
  input: ActionInput<"workstream.create">,
  actor: Actor,
  deps: ActionDeps,
): Promise<{
  name: string;
  origin: WorkstreamOrigin;
  list: WorkstreamMember[];
  size: number;
  named?: true;
}> {
  if (input.kind === "thread") {
    userOnly(actor, "starts a thread from nothing");
    const given = input.name?.trim() ?? blankWorkstreamName;
    const blank = { origin: { kind: "thread" } as const, list: [], size: 0 };
    return given === blankWorkstreamName
      ? { name: blankWorkstreamName, ...blank }
      : { name: given, ...blank, named: true };
  }
  if (input.kind === "window") {
    userOnly(actor, "asks the window chat's first question");
    return { name: windowChatName, origin: { kind: "window" }, list: [], size: 0 };
  }
  if (input.kind === "picked") {
    const list = await members(deps, input.items, actor);
    const size = new Set(list.map((m) => `${m.id}`)).size;
    return { name: input.name.trim(), origin: { kind: "picked" }, list, size };
  }
  if (!isGroupingId(input.grouping))
    throw new ActionError("invalid", "$.grouping: expected epic, assignee, stuck or linked");
  const cluster = deps.clusters(input.grouping).find((c) => c.key === input.cluster);
  if (!cluster) throw new ActionError("not-found", "no such cluster in that grouping");
  const byId = new Map(deps.records().map((r) => [r.id, r]));
  const list = clusterMembers(cluster).flatMap((item) => {
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

async function leaveChat(
  deps: ActionDeps,
  actor: Actor,
  chat: Ulid,
  via: "new-chat" | "continue",
  settles?: (held: Held) => boolean,
): Promise<{ kept: boolean; events: Counted[]; mark: Instant | null }> {
  if (deps.threads.isWindowChat(chat)) deps.threads.leaveWindowChat(chat, deps.now());
  const kept = (await waitsOn(deps, chat, settles)) !== null;
  const done = kept ? null : await markDone({ thread: chat, via }, actor, deps);
  const mark = (done?.undo?.input as { mark?: Instant } | undefined)?.mark ?? null;
  return { kept, events: !done || done.events === "counted" ? [] : done.events, mark };
}

async function markDone(
  { thread: id, via }: ActionInput<"thread.done">,
  actor: Actor,
  deps: ActionDeps,
): Promise<Outcome<Record<string, never>>> {
  const thread = mustThread(deps, id);
  if (bound(actor)) {
    if (thread.id !== ownThread(actor) && deps.running(thread.id))
      throw new ActionError("refused", "the agent is answering in it");
    const waits = await waitsOn(deps, thread.id);
    if (waits) throw new ActionError("refused", `${waits}, so it stays in Needs you`);
  }
  const at = deps.now();
  if (!deps.threads.markDone(thread.id, at, actor))
    return { output: {}, undo: null, changed: null, events: [] };
  return {
    output: {},
    undo: { action: "thread.reopen", input: { thread: thread.id, mark: at } },
    changed: { thread: thread.id },
    events: [
      {
        name: "thread.marked-done",
        threadId: thread.id,
        ...(actor.kind === "user" ? { via: via ?? "page" } : { by: actor }),
      },
    ],
  };
}

function openThread(deps: ActionDeps, workstream: Workstream) {
  const chat =
    workstream.origin.kind === "window" &&
    deps.threads.ofWorkstream(workstream.id, deps.now()).length === 0;
  const thread = deps.newId();
  deps.threads.open(
    { id: thread, workspaceId: deps.workspaceId, workstreamId: workstream.id },
    deps.now(),
  );
  if (chat) deps.threads.startWindowChat(thread);
  const event: Counted = {
    name: "thread.opened",
    threadId: thread,
    workstreamId: workstream.id,
    regionSize: deps.workstreams.region(workstream.id, workstream.version)?.items.length ?? 0,
  };
  return { thread, event };
}

const handlers = {
  "workstream.add": async ({ workstream: id, items }, actor, deps, cause) => {
    const workstream = mustWorkstream(deps, id);
    const change = deps.workstreams.add(
      workstream.id,
      await members(deps, items, actor),
      cause,
      deps.now(),
    );
    const added = (change?.added ?? []).map((member) => member.id);
    if (added.length && workstream.origin.kind === "window")
      for (const { thread } of deps.threads.ofWorkstream(workstream.id, deps.now()))
        deps.threads.moveWindowChat(thread.id);
    return {
      output: { added },
      undo: added.length
        ? { action: "workstream.remove", input: { workstream: workstream.id, items: added } }
        : null,
      changed: change && { workstream: workstream.id, members: true },
      events: (change?.added ?? []).map((member) => ({
        name: "workstream.item-added",
        workstreamId: workstream.id,
        source: parseItemId(member.id)?.kind ?? "jira",
        cause: actor.kind,
      })),
    };
  },

  "workstream.remove": async ({ workstream: id, items }, actor, deps, cause) => {
    const workstream = mustWorkstream(deps, id);
    // By identity: a moved item is removed under its current handle,
    // and one the index no longer has under the handle the workstream shows.
    const held = deps.workstreams.region(workstream.id, workstream.version)?.items ?? [];
    const records = deps.records();
    const named = items.map((item) => {
      const member = memberOf(item, held, records);
      if (!member) throw new ActionError("invalid", `${item} isn't in this workstream`);
      return member;
    });
    // A change set still to apply in any of its threads would stop partway without what it names,
    // and a turn running in another of them works in the workstream as it is.
    if (bound(actor)) {
      const others = deps.threads.ofWorkstream(workstream.id, deps.now());
      if (others.some(({ thread }) => thread.id !== ownThread(actor) && deps.running(thread.id)))
        throw new ActionError("refused", "the agent is answering in another of its threads");
      const sets = await Promise.all(others.map(({ thread }) => deps.unsettled(thread.id)));
      const pending = new Set<string>(sets.flat().flatMap((set) => set.names));
      const held = [...new Set([...items, ...named.map((m) => m.id)])].filter((id) =>
        pending.has(id),
      );
      if (held.length)
        throw new ActionError(
          "refused",
          `${keys(held)} ${held.length === 1 ? "is" : "are"} in a change set that hasn't applied yet, in one of its threads`,
        );
    }
    const change = deps.workstreams.remove(workstream.id, named, cause, deps.now());
    const live = new Map(records.map((record) => [identity(record), record.id]));
    const removed = change?.removed ?? [];
    const back = removed.flatMap((member) => live.get(identity(member)) ?? []);
    return {
      output: {
        removed: removed.map((member) => member.id),
        gone: removed.filter((member) => !live.has(identity(member))).map((m) => m.id),
      },
      undo: back.length
        ? { action: "workstream.add", input: { workstream: workstream.id, items: back } }
        : null,
      changed: change && { workstream: workstream.id, members: true },
      events: [],
    };
  },

  "workstream.create": async (input, actor, deps) => {
    const { name, origin, list, size, named } = await newWorkstream(input, actor, deps);
    const id = deps.newId();
    deps.workstreams.create(
      { id, workspaceId: deps.workspaceId, name, origin },
      list,
      deps.now(),
      actor,
    );
    // So a change set's first epic doesn't name it over the user.
    if (named) deps.workstreams.rename(id, name, "user");
    return {
      output: { workstream: id },
      undo:
        origin.kind === "thread" || origin.kind === "window"
          ? null
          : { action: "workstream.delete", input: { workstream: id } },
      changed: { workstream: id, members: false },
      events: [
        { name: "workstream.created", workstreamId: id, origin: origin.kind, size, ...by(actor) },
      ],
    };
  },

  "workstream.rename": async ({ workstream: id, name, oriel }, actor, deps) => {
    const before = mustWorkstream(deps, id);
    // A change set or a sync names a workstream as Oriel does, never over the
    // user's name.
    if (oriel) {
      userOnly(actor, "gives a workstream's name back to Oriel, by undoing a rename");
      deps.workstreams.giveBack(before.id, name.trim());
    } else
      deps.workstreams.rename(
        before.id,
        name.trim(),
        actor.kind === "change-set" || actor.kind === "sync" ? "oriel" : "user",
      );
    const after = mustWorkstream(deps, id);
    const renamed = after.name !== before.name || after.namedBy !== before.namedBy;
    const back = {
      workstream: before.id,
      name: before.name,
      ...(before.namedBy === "oriel" ? { oriel: true as const } : {}),
    };
    return {
      output: {},
      undo:
        renamed && before.name.trim() !== "" ? { action: "workstream.rename", input: back } : null,
      changed: renamed ? { workstream: before.id, members: false } : null,
      events: [],
    };
  },

  "workstream.done": async ({ workstream: id }, actor, deps) => {
    const workstream = mustWorkstream(deps, id);
    if (bound(actor)) {
      const its = deps.threads.ofWorkstream(workstream.id, deps.now());
      if (its.some(({ thread }) => thread.id !== ownThread(actor) && deps.running(thread.id)))
        throw new ActionError("refused", "the agent is answering in one of its threads");
      for (const { thread } of its) {
        if ((await deps.unsettled(thread.id)).some((set) => set.waits))
          throw new ActionError(
            "refused",
            "a change set in one of its threads waits on you, so it stays in Needs you",
          );
        if (deps.threads.held(thread.id).length > 0)
          throw new ActionError(
            "refused",
            "a message or draft held in one of its threads waits on you, so it stays in Needs you",
          );
      }
    }
    const at = deps.now();
    const marked = deps.threads.markWorkstreamDone(workstream.id, at, actor);
    if (marked === null)
      return { output: { threads: [] as Ulid[] }, undo: null, changed: null, events: [] };
    return {
      output: { threads: marked },
      undo: { action: "workstream.reopen", input: { workstream: workstream.id, mark: at } },
      changed: { workstream: workstream.id, members: false },
      events: [
        {
          name: "workstream.marked-done",
          workstreamId: workstream.id,
          threads: marked.length,
          ...by(actor),
        },
        ...marked.map((thread) => ({
          name: "thread.marked-done" as const,
          threadId: thread,
          workstreamId: workstream.id,
          ...by(actor),
        })),
      ],
    };
  },

  "workstream.reopen": async ({ workstream: id, mark }, _actor, deps) => {
    const workstream = mustWorkstream(deps, id);
    const reopened = deps.threads.reopenWorkstream(workstream.id, mark ?? null, deps.now());
    if (reopened === null)
      throw new ActionError(
        "refused",
        mark === undefined ? "it isn't marked done" : "it was marked done again since",
      );
    return {
      output: { threads: reopened },
      undo: { action: "workstream.done", input: { workstream: workstream.id } },
      changed: { workstream: workstream.id, members: false },
      events: [],
    };
  },

  // Not while a turn runs in one of them or a change set of theirs applies: either may yet write.
  "workstream.delete": async ({ workstream: id, threads: told }, _actor, deps) => {
    const workstream = mustWorkstream(deps, id);
    const its = deps.threads.ofWorkstream(workstream.id, deps.now()).map(({ thread }) => thread.id);
    if (its.length !== (told ?? 0))
      throw told === undefined
        ? new ActionError("refused", "a thread uses it, so it stays")
        : new ActionError(
            "conflict",
            `It has ${its.length === 1 ? "1 thread" : `${its.length} threads`} now. Look again before deleting it.`,
          );
    if (deps.workstreams.delete(workstream.id))
      return {
        output: { threads: [] as Ulid[] },
        undo: null,
        changed: { workstream: workstream.id, members: false },
        events: [
          { name: "workstream.deleted", workstreamId: workstream.id, threads: 0, kept: false },
        ],
      };
    // Read first, then checked and hidden with nothing awaited between, so no
    // turn or apply starts in between.
    const sets = (await Promise.all(its.map((thread) => deps.changeSets.ofThread(thread)))).flat();
    if (its.some(deps.running)) throw new ThreadBusy();
    if (sets.some((set) => deps.changeSets.applying(set.id)))
      throw new ActionError(
        "conflict",
        "A change set in one of its threads is being applied. Wait for it to finish.",
      );
    deps.workstreams.hide(workstream.id, deps.now());
    return {
      output: { threads: its },
      undo: {
        action: "workstream.restore",
        input: { workstream: workstream.id },
      },
      changed: { workstream: workstream.id, deleted: its },
      events: [
        {
          name: "workstream.deleted",
          workstreamId: workstream.id,
          threads: its.length,
          kept: true,
        },
      ],
    };
  },

  "workstream.restore": async ({ workstream: id }, _actor, deps) => {
    if (!deps.workstreams.restore(id, deps.workspaceId))
      throw new ActionError("not-found", "no such deleted workstream");
    const threads = deps.threads.ofWorkstream(id, deps.now()).length;
    return {
      output: {},
      undo: { action: "workstream.delete", input: { workstream: id, threads } },
      changed: { workstream: id, members: false },
      events: [],
    };
  },

  "thread.done": markDone,

  "thread.reopen": async ({ thread: id, mark }, _actor, deps) => {
    const thread = mustThread(deps, id);
    if (thread.state !== "done" || thread.doneBy !== "marked")
      throw new ActionError("refused", "it isn't marked done");
    if (!deps.threads.reopen(thread.id, mark ?? null))
      throw new ActionError("refused", "it was marked done again since");
    return {
      output: {},
      undo: { action: "thread.done", input: { thread: thread.id } },
      changed: { thread: thread.id },
      events: [],
    };
  },

  "held.send": async ({ thread: id, seq, text }, _actor, deps) => {
    const thread = mustThread(deps, id);
    const sent = deps.turns.sendHeld(thread.id, seq, text);
    const rejected = sent.from.kind === "review-link" ? { rejected: sent.from.changeSet } : {};
    if (sent.from.kind === "thread")
      return {
        output: { seq: sent.seq },
        undo: null,
        changed: { thread: thread.id, chat: true },
        events: [
          {
            name: "held-message.sent",
            threadId: thread.id,
            from: sent.from.kind,
            edited: sent.edited,
          },
        ],
      };
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
    const held = deps.turns.discardHeld(thread.id, seq);
    const event =
      "from" in held
        ? { name: "held-message.discarded" as const, threadId: thread.id, from: held.from.kind }
        : {
            name: "draft.discarded" as const,
            threadId: thread.id,
            action: held.draft.action,
            stale: stale(deps, held),
          };
    return { output: {}, undo: null, changed: { thread: thread.id, chat: true }, events: [event] };
  },

  "held.apply": async ({ thread: id, seq, edit }, actor, deps) => {
    const thread = mustThread(deps, id);
    const held = deps.threads.held(thread.id).find((h) => h.seq === seq);
    if (!held || !("draft" in held)) throw new ActionError("not-found", "no draft waits there");
    const { action } = held.draft;
    if (stale(deps, held))
      throw new ActionError(
        "conflict",
        "what it drafts has changed since, so it can't apply: discard it, and ask again",
      );
    const kept = Object.keys(edit ?? {}).find((key) => fixedFields(action).includes(key));
    if (kept !== undefined)
      throw new ActionError("invalid", `$.edit.${kept}: an edit keeps what the draft acts on`);
    const given = { ...held.draft, input: { ...held.draft.input, ...edit } };
    const settled = deps.settle ? await deps.settle(given) : given.input;
    const input = checked(action, settled as Fields<typeof action>);
    const handler = handlers[action] as Handler<typeof action>;
    const called = await handler(input, actor, deps, actor);
    const output = called.output as SourceOutcome | { thread: Ulid; workstream: Ulid };
    if (!("connection" in output) && "problem" in output)
      throw new ActionError("refused", output.problem);
    const as =
      "connection" in output
        ? { ...input, options: output.connection.options }
        : { ...input, to: output.thread };
    if (!deps.threads.applied(thread.id, seq, as))
      throw new ActionError("conflict", "it was settled meanwhile");
    const events = called.events === "counted" ? [] : called.events;
    return {
      output: { ...output, applied: called.undo },
      undo: null,
      changed: { thread: thread.id, chat: true },
      events: [
        ...events,
        { name: "draft.applied", threadId: thread.id, action, edited: edit !== undefined },
      ],
    };
  },

  "thread.open": async ({ workstream: id }, _actor, deps) => {
    const { thread, event } = openThread(deps, mustWorkstream(deps, id));
    return { output: { thread }, undo: null, changed: { thread }, events: [event] };
  },

  // Not while its agent answers, which could say more after the quote.
  "thread.continue": async ({ thread: id, workstream: to }, actor, deps) => {
    const thread = mustThread(deps, id);
    const workstream = mustWorkstream(deps, to);
    if (workstream.id === thread.workstreamId)
      throw new ActionError("refused", "it's on that workstream already");
    if (thread.state !== "working") throw new ActionError("refused", "it isn't working");
    if (deps.threads.workstreamDone(workstream.id, deps.now()) !== null)
      throw new ActionError("refused", "that workstream is done");
    if (deps.running(thread.id)) throw new ThreadBusy();
    const { thread: next, event: opened } = openThread(deps, workstream);
    const first = deps.threads.messages(thread.id).find((m) => m.role === "user");
    const title =
      deps.threads.title(thread.id) ?? (first?.role === "user" ? clippedTitle(first.text) : null);
    if (title !== null) deps.threads.setTitle(next, title, deps.now());
    deps.turns.continued(thread.id, next);
    const { kept, events: marked, mark } = await leaveChat(deps, actor, thread.id, "continue");
    return {
      output: { thread: next, kept },
      undo: {
        action: "thread.uncontinue",
        input: { thread: next, ...(mark ? { mark } : {}) },
      },
      changed: { thread: thread.id },
      events: [
        opened,
        ...marked,
        {
          name: "thread.continued",
          threadId: next,
          from: thread.id,
          workstreamId: workstream.id,
          kept,
        },
      ],
    };
  },

  // Refused once anything was said in the new thread, so an Undo never erases words.
  "thread.uncontinue": async ({ thread: id, mark }, _actor, deps) => {
    const thread = mustThread(deps, id);
    const messages = deps.threads.messages(thread.id);
    const from = messages.flatMap((m) =>
      m.role === "held" && "from" in m && m.from.kind === "thread" ? [m.from.thread] : [],
    )[0];
    if (messages.some((m) => m.role === "user" || m.role === "agent"))
      throw new ActionError("conflict", "Something was said in the new thread since, so it stays.");
    if (deps.running(thread.id)) throw new ThreadBusy();
    if (!deps.threads.delete(thread.id, deps.now(), (set) => deps.changeSets.applying(set)))
      throw new ActionError("conflict", "A change set of the new thread is being applied.");
    if (mark && from) deps.threads.reopen(from as Ulid, mark);
    return {
      output: {},
      undo: null,
      changed: { thread: thread.id, deleted: true },
      events: [],
    };
  },

  "thread.say": async ({ thread: id, text, about }, _actor, deps) => {
    const thread = mustThread(deps, id);
    const { seq } = deps.turns.say(thread.id, text, about);
    return { output: { seq }, undo: null, changed: null, events: "counted" };
  },

  "thread.retry": async ({ thread: id }, _actor, deps) => {
    const thread = mustThread(deps, id);
    return { output: deps.turns.retry(thread.id), undo: null, changed: null, events: [] };
  },

  "thread.stop": async ({ thread: id }, _actor, deps) => {
    const thread = mustThread(deps, id);
    return {
      output: { stopped: deps.turns.stop(thread.id) },
      undo: null,
      changed: null,
      events: [],
    };
  },

  // Not while its agent answers: its turn works in the version it started in.
  "thread.sync": async ({ thread: id }, _actor, deps) => {
    const thread = mustThread(deps, id);
    if (deps.running(thread.id)) throw new ThreadBusy();
    const moved = deps.threads.catchUp(thread.id, deps.now(), deps.newId());
    return {
      output: { moved: moved !== null },
      undo: null,
      changed: moved && { thread: thread.id, moved },
      events: [],
    };
  },

  // Not while its agent answers or a change set of it applies: either may
  // yet write.
  "thread.delete": async ({ thread: id, via }, _actor, deps) => {
    const thread = mustThread(deps, id);
    if (deps.running(thread.id)) throw new ThreadBusy();
    const deleted = deps.threads.delete(thread.id, deps.now(), (set) =>
      deps.changeSets.applying(set),
    );
    if (!deleted)
      throw new ActionError(
        "conflict",
        "A change set of this thread is being applied. Wait for it to finish.",
      );
    return {
      output: { workstreamId: deleted.workstreamId, workstreamRemoved: deleted.workstreamRemoved },
      undo: null,
      changed: { thread: thread.id, deleted: true },
      events: [
        {
          name: "thread.deleted",
          threadId: thread.id,
          workstreamId: deleted.workstreamId,
          kept: deleted.kept,
          workstreamRemoved: deleted.workstreamRemoved,
          via: via ?? "menu",
        },
      ],
    };
  },

  "changeset.edit": async ({ changeSet: id, remove }, _actor, deps) => {
    const set = await mustChangeSet(deps, id);
    const edited = await deps.changeSets.edit(set.id, { remove: remove as Ulid[] });
    return {
      output: {},
      undo: null,
      changed: { thread: set.threadId, changeSet: set.id, applying: false },
      events: edited.hash === set.hash ? [] : "counted",
    };
  },

  "changeset.second-look": async ({ changeSet: id }, _actor, deps) => {
    const set = await mustChangeSet(deps, id);
    if (!deps.secondLook) throw new ActionError("refused", "second looks are off here");
    if (set.decision !== null || set.revertOf !== null)
      throw new ActionError(
        "refused",
        "a second look is only of a change set nobody has decided on",
      );
    await deps.secondLook.take(set.id);
    return { output: {}, undo: null, changed: null, events: [] };
  },

  "changeset.dismiss-look": async ({ changeSet: id, look }, _actor, deps) => {
    const set = await mustChangeSet(deps, id);
    if (!deps.secondLook) throw new ActionError("refused", "second looks are off here");
    try {
      deps.secondLook.dismiss(set.id, look as Ulid);
    } catch (error) {
      if (error instanceof RangeError) throw new ActionError("not-found", error.message);
      throw error;
    }
    return { output: {}, undo: null, changed: null, events: [] };
  },

  "changeset.add-suggestion": async ({ changeSet: id, look, places }, _actor, deps) => {
    const set = await mustChangeSet(deps, id);
    if (!deps.secondLook) throw new ActionError("refused", "second looks are off here");
    const added = await deps.secondLook
      .add(set.id, look as Ulid, places)
      .catch((error: unknown) => {
        if (error instanceof RangeError) throw new ActionError("not-found", error.message);
        throw error;
      });
    return {
      output: {},
      undo: null,
      changed: { thread: added.threadId, changeSet: added.id, applying: false },
      events: "counted",
    };
  },

  // The decision stands even if applying it is refused (another apply is under way, say).
  "changeset.approve": async ({ changeSet: id, hash, token }, actor, deps) => {
    const set = await mustChangeSet(deps, id);
    await deps.changeSets.decide(set.id, "approved", approverOf(actor, token), hash);
    try {
      const report = await applyTold(deps, set);
      return {
        output: { report, problem: null },
        undo: null,
        changed: null,
        events: "counted",
      };
    } catch (error) {
      if (!isChangeSetError(error)) throw error;
      return {
        output: { report: null, problem: error.message },
        undo: null,
        changed: null,
        events: "counted",
      };
    }
  },

  // A review link's holder can't reply in the thread, so their reason is held there for the user.
  "changeset.reject": async ({ changeSet: id, hash, reason, token }, actor, deps) => {
    const set = await mustChangeSet(deps, id);
    const approver = approverOf(actor, token);
    if (approver.via === "thread" && reason !== undefined)
      throw new ActionError(
        "invalid",
        "$.reason: only a review link gives a reason; in the thread, reply to say what was wrong",
      );
    if (reason !== undefined && reason.length > maxReasonChars)
      throw new ActionError(
        "invalid",
        `$.reason: expected a reason of 1 to ${maxReasonChars} characters`,
      );
    const decided = await deps.changeSets.decide(set.id, "rejected", approver, hash);
    deps.publish({ thread: set.threadId, changeSet: set.id, applying: false });
    deps.turns.rejected(
      decided,
      approver.via === "review-link" ? { by: approver.by, reason: reason ?? null } : null,
    );
    // A review link's holder has nowhere to undo from, and the link died with the decision.
    // A revert's has none: Revert again makes another.
    const undo =
      approver.via === "thread" && decided.decision && set.revertOf === null
        ? {
            action: "changeset.unreject" as const,
            input: { changeSet: set.id, decision: decided.decision.id },
          }
        : null;
    return {
      output: { report: null, problem: null },
      undo,
      changed: null,
      events: "counted",
    };
  },

  // Only while the thread hasn't moved on: once the person has said anything to the agent since,
  // it is working from the rejection, and they ask it for the change again instead.
  "changeset.unreject": async ({ changeSet: id, decision }, _actor, deps) => {
    const set = await mustChangeSet(deps, id);
    const rejection = set.decision;
    if (rejection?.kind !== "rejected" || rejection.id !== decision)
      throw new ActionError("refused", "it isn't rejected as it was, so there's nothing to undo");
    const said = deps.threads
      .messages(set.threadId)
      .some((m) => m.role === "user" && m.at > rejection.at);
    if (said)
      throw new ActionError(
        "refused",
        "you've told the agent what was wrong since, so it is working from that rejection: ask it for the change again",
      );
    const undone = await deps.changeSets.undoRejection(set.id);
    deps.turns.unrejected(undone);
    return {
      output: { report: null, problem: null },
      undo: null,
      changed: { thread: set.threadId, changeSet: set.id, applying: false },
      events: "counted",
    };
  },

  "changeset.apply": async ({ changeSet: id }, _actor, deps) => {
    const set = await mustChangeSet(deps, id);
    return {
      output: { report: await applyTold(deps, set) },
      undo: null,
      changed: null,
      events: [],
    };
  },

  "changeset.dismiss": async ({ changeSet: id, hash, token }, actor, deps) => {
    const set = await mustChangeSet(deps, id);
    const dismissed = await deps.changeSets.dismiss(set.id, approverOf(actor, token), hash);
    return {
      output: { warnings: dismissed.warnings },
      undo: null,
      changed: { thread: set.threadId, changeSet: set.id, applying: false },
      events: dismissed.changeSet.decision?.id === set.decision?.id ? [] : "counted",
    };
  },

  "changeset.revert": async ({ changeSet: id }, _actor, deps) => {
    const set = await mustChangeSet(deps, id);
    const reverted = await deps.changeSets.revert(set.id);
    if ("conflicts" in reverted)
      return {
        output: { conflicts: reverted.conflicts },
        undo: null,
        changed: null,
        events: "counted",
      };
    return {
      output: { revert: reverted.id },
      undo: null,
      changed: { thread: set.threadId, changeSet: set.id, applying: false },
      events: "counted",
    };
  },

  "review-link.create": async ({ changeSet: id }, _actor, deps) => {
    const set = await mustChangeSet(deps, id);
    const url = await deps.changeSets.reviewLink(set.id);
    return { output: { url: url.href }, undo: null, changed: null, events: [] };
  },

  "review-link.revoke": async ({ changeSet: id }, _actor, deps) => {
    const set = await mustChangeSet(deps, id);
    await deps.changeSets.revokeReviewLink(set.id);
    return { output: {}, undo: null, changed: null, events: [] };
  },

  "source.connect": async (input, _actor, deps) => {
    const { outcome, counted } = await deps.sources.connect(input);
    return { output: outcome, undo: null, changed: null, events: counted ? "counted" : [] };
  },

  // Which options changed is counted, never their values.
  "item.edit": async (input, _actor, deps) => {
    const { before, after } = await deps.edit(input.item, input.values);
    return {
      output: { item: input.item, values: after },
      undo:
        Object.keys(before).length > 0
          ? { action: "item.edit", input: { item: input.item, values: before } }
          : null,
      changed: null,
      events: "counted",
    };
  },

  "source.configure": async (input, _actor, deps) => {
    const { outcome, changed, replaced } = await deps.sources.configure(input);
    if (!("connection" in outcome) || changed.length === 0)
      return { output: outcome, undo: null, changed: null, events: [] };
    const { kind, number } = outcome.connection;
    return {
      output: outcome,
      undo: {
        action: "source.configure",
        input: { connection: input.connection, options: replaced },
      },
      changed: null,
      events: [
        { name: "source.configured", source: kind, later: number > 1, options: [...changed] },
      ],
    };
  },

  "source.sync": async (input, _actor, deps) => {
    const { outcome, of } = await deps.sources.sync(input);
    return {
      output: outcome,
      undo: null,
      changed: null,
      events: [{ name: "source.synced", source: of.kind, ok: !("problem" in outcome) }],
    };
  },

  // Counted by its kind only, never the source server's name.
  "source.off": async ({ kind }, actor, deps) => {
    const by = actor.kind === "agent" ? "agent" : "person";
    const { server } = await deps.kinds.off(kind, by);
    return {
      output: { kind },
      undo: { action: "source.on", input: { kind, ...(server ? { server } : {}) } },
      changed: null,
      events: [{ name: "source.turned", source: kind, on: false, by }],
    };
  },
  "source.on": async ({ kind, server }, _actor, deps) => {
    await deps.kinds.on(kind, server);
    return {
      output: { kind },
      undo: { action: "source.off", input: { kind } },
      changed: null,
      events: [{ name: "source.turned", source: kind, on: true, by: "person" }],
    };
  },
  "source.dismiss-found": async (_, _actor, deps) => {
    deps.kinds.dismiss();
    return { output: {}, undo: null, changed: null, events: [] };
  },

  "source.disconnect": async (input, _actor, deps) => {
    const gone = await deps.sources.disconnect(input);
    return {
      output: { disconnected: gone.id },
      undo: null,
      changed: null,
      events: [{ name: "source.disconnected", source: gone.kind, later: gone.number > 1 }],
    };
  },

  // A turn still running in the old chat stops, so it proposes nothing behind the user's back.
  "window.new-chat": async (_, actor, deps) => {
    const thread = deps.threads.windowChat(deps.workspaceId, deps.now());
    if (!thread) return { output: { left: null }, undo: null, changed: null, events: [] };
    deps.turns.stop(thread.id);
    const { kept, events } = await leaveChat(deps, actor, thread.id, "new-chat");
    return {
      output: { left: thread.id },
      undo: null,
      changed: { thread: thread.id },
      events: [...events, { name: "window-chat.new-chat", threadId: thread.id, kept }],
    };
  },

  "window.open-as-thread": async ({ thread: id }, _actor, deps) => {
    const chat = deps.threads.windowChat(deps.workspaceId, deps.now());
    if (chat?.id !== id) return { output: { moved: false }, undo: null, changed: null, events: [] };
    deps.threads.moveWindowChat(id);
    return { output: { moved: true }, undo: null, changed: { thread: id }, events: [] };
  },

  "window.continue": async ({ thread: id, item, seq }, actor, deps) => {
    const chat = mustThread(deps, id);
    if (!deps.threads.isWindowChat(chat.id))
      throw new ActionError("refused", "only the window chat continues elsewhere");
    const said =
      seq === undefined
        ? undefined
        : deps.threads.messages(chat.id, seq - 1).find((message) => message.seq === seq);
    if (said?.role !== "user") throw new ActionError("not-found", "no message of the user's there");
    const about = [...new Set([item, ...(said.about ?? []).map((each) => each.id)])].slice(
      0,
      maxAbout,
    );
    const events: Counted[] = [];
    let workstream = deps.holding?.(item)?.id ?? null;
    const made = workstream === null;
    if (workstream === null) {
      const record = deps.records().find((each) => each.id === item);
      const key = parseItemId(item)?.key ?? item;
      const create = handlers["workstream.create"] as Handler<"workstream.create">;
      const created = await create(
        { kind: "picked", name: nameOf(record?.title ?? "") || key, items: [item] },
        actor,
        deps,
        actor,
      );
      if (created.events !== "counted") events.push(...created.events);
      workstream = (created.output as { workstream: Ulid }).workstream;
    }
    const open = handlers["thread.open"] as Handler<"thread.open">;
    const opened = await open({ workstream }, actor, deps, actor);
    if (opened.events !== "counted") events.push(...opened.events);
    const to = (opened.output as { thread: Ulid }).thread;
    const from = {
      kind: "window-chat" as const,
      chat: chat.id,
      seq: said.seq,
      about: about.map((each) => ({ id: each, under: null })),
    };
    const sent = deps.turns.carry(to, from, said.text);
    if (sent)
      events.push({
        name: "question.asked",
        threadId: to,
        held: { from: from.kind, edited: false },
      });
    deps.publish({ thread: to });
    // Left as New chat leaves it: its turn stops, so none holds a draft later.
    deps.turns.stop(chat.id);
    const offer = (held: Held) => "draft" in held && held.draft.action === "window.continue";
    const left = await leaveChat(deps, actor, chat.id, "continue", offer);
    events.push(...left.events, {
      name: "window-chat.continued",
      threadId: chat.id,
      to,
      made,
      kept: left.kept,
    });
    return {
      output: { thread: to, workstream },
      undo: null,
      changed: { thread: chat.id, chat: true },
      events,
    };
  },

  "overview.leave": async ({ seq }, _actor, deps) => {
    const seenAt = deps.now();
    deps.markSeen(seenAt, seq);
    return { output: { seenAt }, undo: null, changed: null, events: [] };
  },

  "noticed.dismiss": async ({ signal }, _actor, deps) => {
    const kind = await noticedOf(deps).dismiss(signal);
    if (!kind) throw new ActionError("not-found", "That card isn't there any more.");
    return { output: {}, undo: null, changed: null, events: [{ name: "noticed.dismissed", kind }] };
  },

  "noticed.pin": async ({ signal }, _actor, deps) => {
    const pinned = await noticedOf(deps).pin(signal);
    if (!pinned) throw new ActionError("not-found", "That card isn't there any more.");
    if ("refused" in pinned) throw new ActionError("conflict", pinned.refused);
    return {
      output: { id: pinned.id },
      undo: null,
      changed: null,
      events: [{ name: "noticed.pinned", kind: pinned.kind }],
    };
  },

  "noticed.unpin": async ({ pin }, _actor, deps) => {
    if (!noticedOf(deps).unpin(pin as Ulid)) throw new ActionError("not-found", "no such pin");
    return { output: {}, undo: null, changed: null, events: [] };
  },
} satisfies { [N in ActionName]: Handler<N> };

const noticedOf = (deps: ActionDeps) => {
  const noticed = deps.noticed?.();
  if (!noticed) throw new ActionError("not-found", "Noticed isn't on here");
  return noticed;
};

// A review-link holder may only decide or dismiss the change set the link names, as the change set engine checks.
export function refusal(name: ActionName, actor: Actor): string | null {
  const declared: ActionDeclaration = actions[name];
  if (actor.kind === "user") return null;
  if (actor.kind === "review-link")
    return declared.reviewLink ? null : `${name} isn't for a review link`;
  if (declared.class.kind === "person-only") return `${name} is the user's: ${declared.class.why}`;
  if (actor.kind === "change-set" || actor.kind === "sync") return null;
  const closed = declared.closed?.[actor.kind === "agent" ? "agent" : "tool"];
  return closed === undefined ? null : `${name} is closed to ${actor.kind}s: ${closed}`;
}

type Output<N extends ActionName> = Awaited<ReturnType<(typeof handlers)[N]>>["output"];
type Result<N extends ActionName> = Output<N> & { undo: Call | null };
// `untyped` is for doors whose action is known only at run time: an Undo sent back, and a turn's recorded intents.
// Either way the dispatcher checks the input.
export type Dispatch = {
  <N extends ActionName>(name: N, input: ActionInput<N>, actor: Actor): Promise<Result<N>>;
  untyped(
    name: ActionName,
    input: unknown,
    actor: Actor,
    undoes?: Actor,
    via?: Ulid,
  ): Promise<{ undo: Call | null }>;
};

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
    undoes?: Actor,
    via?: Ulid,
  ): Promise<Result<N>> => {
    const why = refusal(name, actor);
    if (why !== null) throw new ActionError("refused", why);
    const declared: ActionDeclaration = actions[name];
    const handler = handlers[name] as Handler<typeof name>;
    const cause =
      actor.kind === "user" && via !== undefined ? { kind: "user" as const, via } : actor;
    const outcome = await handler(checked(name, raw as Fields<N>), actor, deps, cause);
    if (outcome.undo && outcome.undo.action !== declared.class.inverse)
      throw new Error(`${name} gave an undo that isn't its inverse`);
    const at = deps.now();
    const { workspaceId } = deps;
    const events =
      outcome.events === "counted"
        ? []
        : outcome.events.length
          ? outcome.events
          : [{ name: "action.called" as const, action: name, by: actor }];
    const undid = undoes && undoes.kind !== "user" ? { undoes } : {};
    for (const event of events)
      deps.emit({ ...event, ...undid, at, workspaceId } as TelemetryEvent);
    if (outcome.changed) deps.publish(outcome.changed);
    return { ...(outcome.output as Output<typeof name>), undo: outcome.undo };
  };
  return Object.assign(
    <N extends ActionName>(name: N, input: ActionInput<N>, actor: Actor) =>
      untyped(name, input, actor),
    { untyped },
  );
}
