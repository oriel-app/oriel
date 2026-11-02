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
  type Approver,
  type Call,
  type ChangeSet,
  type ChangeSets,
  type Cluster,
  type WorkstreamMember,
  type WorkstreamOrigin,
  type IndexRecord,
  type Instant,
  type ItemId,
  maxReasonChars,
  parseItemId,
  type TelemetryEvent,
  type Ulid,
} from "@oriel/core";
import type { WorkstreamStore, ThreadStore } from "@oriel/db";
import { type FolderView, type GroupingId, isGroupingId, type JiraView } from "@oriel/web/view";
import { nameOf } from "./names.ts";
import { ThreadBusy, ThreadLimit, type Turns } from "./turns.ts";
import { identity, memberOf } from "./views.ts";

// What a workstream made for a thread from nothing is called, until a change set
// creates its epic and it takes that epic's name.
export const blankWorkstreamName = "New workstream";

// A refusal the doors map: the window's routes to 400, 403, 404 or 409.
// `conflict`: not now, while something else is under way or missing.
export class ActionError extends Error {
  readonly code: "invalid" | "refused" | "not-found" | "conflict";
  constructor(code: ActionError["code"], message: string) {
    super(message);
    this.name = "ActionError";
    this.code = code;
  }
}

// What a call changed, for the window's streams: a workstream, and whether its
// members changed, which moves its working threads; a thread, and whether an
// entry already in its chat changed, as a held message settles, or whether
// it is gone; or a change set of a thread, and whether it is applying now.
export type Changed =
  | { workstream: Ulid; members: boolean }
  | { thread: Ulid; chat?: true }
  | { thread: Ulid; deleted: true }
  | { thread: Ulid; changeSet: Ulid; applying: boolean };

// A source the user connects or syncs from the window, as it stands then; or
// what went wrong, in plain words.
export type SourceOutcome = { folder: FolderView } | { jira: JiraView } | { problem: string };

// A change-set refusal (`ChangeSetError`, by its name and code), which the
// window's routes map by its code.
export const isChangeSetError = (error: unknown): error is Error & { code: string } =>
  error instanceof Error && error.name === "ChangeSetError" && "code" in error;

export type ActionDeps = {
  workspaceId: Ulid;
  workstreams: WorkstreamStore;
  threads: ThreadStore;
  // The index's live records, from every source.
  records(): readonly IndexRecord[];
  // A grouping's clusters as the window shows them now.
  clusters(grouping: GroupingId): Cluster[];
  // What a change set created, which joins its workstream before the index has it.
  created(changeSetId: Ulid): Promise<WorkstreamMember[]>;
  // What becomes of a thread's chat: the user's message, which starts a
  // turn; a message held in it, whoever it is from; and its running turn.
  turns: Pick<Turns, "say" | "rejected" | "stop" | "sendHeld" | "discardHeld">;
  changeSets: ChangeSets;
  // After a change set applied, partly or in full: what it created joins
  // the workstream, and a live index syncs.
  applied(set: ChangeSet): Promise<void>;
  // Connecting a source, and the sync the user asks for. A source not
  // connected yet can't sync: an ActionError.
  sources: {
    // `counted`: it emitted `source.connected`, as a source's first sync
    // into the workspace does.
    connect(
      input: ActionInput<"source.connect">,
    ): Promise<{ outcome: SourceOutcome; counted: boolean }>;
    sync(source: ActionInput<"source.sync">["source"]): Promise<SourceOutcome>;
  };
  // Whether a turn runs in a thread now.
  running(threadId: Ulid): boolean;
  // A thread's change sets still to apply, pending or approved: whether
  // each waits on the user, and the items it names.
  unsettled(threadId: Ulid): Promise<{ waits: boolean; names: readonly ItemId[] }[]>;
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
// none, the dispatcher counts it as `action.called`; `counted` when what it
// called counts it, as the change set engine and a turn do, so nothing is
// counted twice.
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
) => Promise<Outcome<unknown>>;

// The user's own doing goes unsaid in an event; anyone else is named.
const by = (actor: Actor): { by?: Actor } => (actor.kind === "user" ? {} : { by: actor });

// What only the user may ask of an action, in the window: anyone else is
// refused it, whatever door they came through.
const userOnly = (actor: Actor, what: string) => {
  if (actor.kind !== "user") throw new ActionError("refused", `only the user ${what}`);
};

// The agent and outside tools, whom the host holds to what a person may
// still do (decision 0024); and the agent's own thread, whose turn is the
// one acting.
const bound = (actor: Actor) => actor.kind === "agent" || actor.kind === "tool";
const ownThread = (actor: Actor) => (actor.kind === "agent" ? actor.threadId : null);
const keys = (ids: readonly string[]) => ids.map((id) => parseItemId(id)?.key ?? id).join(", ");

const mustWorkstream = (deps: ActionDeps, id: Ulid) => {
  const workstream = deps.workstreams.get(id);
  if (!workstream || workstream.workspaceId !== deps.workspaceId)
    throw new ActionError("not-found", "no such workstream");
  return workstream;
};

// A thread this workspace has.
const mustThread = (deps: ActionDeps, id: Ulid) => {
  const thread = deps.threads.get(id, deps.now());
  if (!thread || thread.workspaceId !== deps.workspaceId)
    throw new ActionError("not-found", "no such thread");
  return thread;
};

// A change set this workspace has, or null. One of a deleted thread, kept
// for what it wrote, is gone with it.
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

// Who decides a change set: the user, in its thread, or a review link's
// holder, who presents the link's token, which the engine checks.
const approverOf = (actor: Actor, token: string | undefined): Approver => {
  if (actor.kind === "review-link" && token !== undefined)
    return { via: "review-link", token, by: actor.by };
  if (actor.kind === "user" && token === undefined) return { via: "thread", by: "user" };
  throw new ActionError("invalid", "only a review link's holder gives its token, and they must");
};

// Applies a change set, and tells when that starts and when it ends. The
// engine marks it applying before `apply` returns its promise, so the first
// reload sees that. What it created then joins its workstream.
const applyTold = async (deps: ActionDeps, set: ChangeSet) => {
  const applying = deps.changeSets.apply(set.id);
  deps.publish({ thread: set.threadId, changeSet: set.id, applying: true });
  let report: Awaited<typeof applying>;
  try {
    report = await applying;
  } finally {
    deps.publish({ thread: set.threadId, changeSet: set.id, applying: false });
  }
  await deps.applied(await mustChangeSet(deps, set.id));
  return report;
};

// Items as the index has them now. One it doesn't have is refused, unless
// the change set acting created it, as it joins before the next sync.
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

// What a new workstream is called, where it came from and what it holds: a copy
// of a cluster's members, its anchor included; picked items; or nothing.
// `size` is how many items it starts with.
async function newWorkstream(
  input: ActionInput<"workstream.create">,
  actor: Actor,
  deps: ActionDeps,
): Promise<{ name: string; origin: WorkstreamOrigin; list: WorkstreamMember[]; size: number }> {
  if (input.kind === "thread") {
    userOnly(actor, "starts a thread from nothing");
    return { name: blankWorkstreamName, origin: { kind: "thread" }, list: [], size: 0 };
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
    const workstream = mustWorkstream(deps, id);
    const change = deps.workstreams.add(
      workstream.id,
      await members(deps, items, actor),
      actor,
      deps.now(),
    );
    const added = (change?.added ?? []).map((member) => member.id);
    return {
      output: { added },
      undo: added.length
        ? { action: "workstream.remove", input: { workstream: workstream.id, items: added } }
        : null,
      changed: change && { workstream: workstream.id, members: true },
      events: (change?.added ?? []).map((member) => ({
        name: "workstream.item-added",
        workstreamId: workstream.id,
        source: parseItemId(member.id)?.source ?? "jira",
        cause: actor.kind,
      })),
    };
  },

  "workstream.remove": async ({ workstream: id, items }, actor, deps) => {
    const workstream = mustWorkstream(deps, id);
    // By identity: a moved item is removed under its current handle, and
    // one the index no longer has under the handle the workstream shows.
    const held = deps.workstreams.region(workstream.id, workstream.version)?.items ?? [];
    const records = deps.records();
    const named = items.map((item) => {
      const member = memberOf(item, held, records);
      if (!member) throw new ActionError("invalid", `${item} isn't in this workstream`);
      return member;
    });
    // A change set still to apply in any of the workstream's threads would
    // stop partway without what it names (decision 0018), and a turn running
    // in another of them works in the workstream as it is.
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
    const change = deps.workstreams.remove(workstream.id, named, actor, deps.now());
    // Back under the handle the index has now; one it no longer has can't
    // come back.
    const live = new Map(records.map((record) => [identity(record), record.id]));
    const back = (change?.removed ?? []).flatMap((member) => live.get(identity(member)) ?? []);
    return {
      output: {},
      undo: back.length
        ? { action: "workstream.add", input: { workstream: workstream.id, items: back } }
        : null,
      changed: change && { workstream: workstream.id, members: true },
      events: [],
    };
  },

  "workstream.create": async (input, actor, deps) => {
    const { name, origin, list, size } = await newWorkstream(input, actor, deps);
    const id = deps.newId();
    deps.workstreams.create(
      { id, workspaceId: deps.workspaceId, name, origin },
      list,
      deps.now(),
      actor,
    );
    return {
      output: { workstream: id },
      // One made for a thread from nothing is that thread's from the start.
      undo:
        origin.kind === "thread"
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
      changed: renamed ? { workstream: before.id, members: false } : null,
      events: [],
    };
  },

  "workstream.delete": async ({ workstream: id }, _actor, deps) => {
    const workstream = mustWorkstream(deps, id);
    if (!deps.workstreams.delete(workstream.id))
      throw new ActionError("refused", "a thread uses it, so it stays");
    return {
      output: {},
      undo: null,
      changed: { workstream: workstream.id, members: false },
      events: [],
    };
  },

  "thread.done": async ({ thread: id, via }, actor, deps) => {
    const thread = mustThread(deps, id);
    // The thread stays in Needs you while it waits on the user, for a
    // change set or a held message, and isn't closed under another turn.
    if (bound(actor)) {
      if (thread.id !== ownThread(actor) && deps.running(thread.id))
        throw new ActionError("refused", "the agent is answering in it");
      if ((await deps.unsettled(thread.id)).some((set) => set.waits))
        throw new ActionError(
          "refused",
          "a change set in it waits on you, so it stays in Needs you",
        );
      if (deps.threads.held(thread.id).length > 0)
        throw new ActionError(
          "refused",
          "a message held in it waits on you, so it stays in Needs you",
        );
    }
    const at = deps.now();
    // Marked done already, it keeps who marked it and when, so there is
    // nothing to undo and no mark to count.
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
          // Only the user closes it from somewhere in the window.
          ...(actor.kind === "user" ? { via: via ?? "page" } : { by: actor }),
        },
      ],
    };
  },

  "thread.reopen": async ({ thread: id, mark }, _actor, deps) => {
    const thread = mustThread(deps, id);
    // What a change set settled, or handed off, a message reopens.
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
    const from = deps.turns.discardHeld(thread.id, seq);
    return {
      output: {},
      undo: null,
      changed: { thread: thread.id, chat: true },
      events: [{ name: "held-message.discarded", threadId: thread.id, from: from.kind }],
    };
  },

  "thread.open": async ({ workstream: id }, _actor, deps) => {
    const workstream = mustWorkstream(deps, id);
    const thread = deps.newId();
    deps.threads.open(
      { id: thread, workspaceId: deps.workspaceId, workstreamId: workstream.id },
      deps.now(),
    );
    return {
      output: { thread },
      undo: null,
      changed: { thread },
      events: [
        {
          name: "thread.opened",
          threadId: thread,
          workstreamId: workstream.id,
          regionSize: deps.workstreams.region(workstream.id, workstream.version)?.items.length ?? 0,
        },
      ],
    };
  },

  // The turn counts the question, and tells the thread's pages.
  "thread.say": async ({ thread: id, text }, _actor, deps) => {
    const thread = mustThread(deps, id);
    const { seq } = deps.turns.say(thread.id, text);
    return { output: { seq }, undo: null, changed: null, events: "counted" };
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
      // The engine counts an edit that changed something.
      events: edited.hash === set.hash ? [] : "counted",
    };
  },

  // Approving is what lets Oriel write, so replay follows it (decision
  // 0003). The decision stands even if applying it is refused (another
  // apply is under way, say): the change set says where it stands, and why.
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

  // A rejection is the thread's to answer: it asks what was wrong. The
  // user's own reason is the answer, which starts a turn; one that can't be
  // said, mid-turn or past the thread's caps, leaves the rejection
  // standing, and says why. A review link's holder's is held in the thread
  // for the user, whatever the turn or the caps, and is shorter.
  "changeset.reject": async ({ changeSet: id, hash, reason, token }, actor, deps) => {
    const set = await mustChangeSet(deps, id);
    const approver = approverOf(actor, token);
    if (approver.via === "review-link" && reason !== undefined && reason.length > maxReasonChars)
      throw new ActionError(
        "invalid",
        `$.reason: expected a reason of 1 to ${maxReasonChars} characters`,
      );
    const decided = await deps.changeSets.decide(set.id, "rejected", approver, hash);
    deps.publish({ thread: set.threadId, changeSet: set.id, applying: false });
    const outcome = { undo: null, changed: null, events: "counted" } as const;
    try {
      deps.turns.rejected(
        decided,
        approver.via === "review-link" ? approver.by : null,
        reason ?? null,
      );
      return { ...outcome, output: { report: null, problem: null } };
    } catch (error) {
      if (!(error instanceof ThreadBusy || error instanceof ThreadLimit)) throw error;
      return { ...outcome, output: { report: null, problem: error.message } };
    }
  },

  // Counted as `changeset.applied` only once it has applied in full, by
  // whichever call: this one is counted as itself.
  "changeset.apply": async ({ changeSet: id }, _actor, deps) => {
    const set = await mustChangeSet(deps, id);
    return {
      output: { report: await applyTold(deps, set) },
      undo: null,
      changed: null,
      events: [],
    };
  },

  // The warnings name changes that may already have landed, for the person
  // to check.
  "changeset.dismiss": async ({ changeSet: id, hash, token }, actor, deps) => {
    const set = await mustChangeSet(deps, id);
    const dismissed = await deps.changeSets.dismiss(set.id, approverOf(actor, token), hash);
    return {
      output: { warnings: dismissed.warnings },
      undo: null,
      changed: { thread: set.threadId, changeSet: set.id, applying: false },
      // The engine counts one it dismissed, not one that was already.
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

  // Counted as `source.connected` when the source first syncs into the
  // workspace, and otherwise, failed or connected again, as itself.
  "source.connect": async (input, _actor, deps) => {
    const { outcome, counted } = await deps.sources.connect(input);
    return { output: outcome, undo: null, changed: null, events: counted ? "counted" : [] };
  },

  // How often the user asks says whether Oriel should sync on its own. What
  // a sync changed, every page watching hears from the sync itself.
  "source.sync": async ({ source }, _actor, deps) => {
    const synced = await deps.sources.sync(source);
    return {
      output: synced,
      undo: null,
      changed: null,
      events: [{ name: "source.synced", source, ok: !("problem" in synced) }],
    };
  },
} satisfies { [N in ActionName]: Handler<N> };

// Why `actor` may not call the action, or null. A review-link holder may only
// decide or dismiss the change set the link names, as the change set engine
// checks. A change set acts only through what follows its apply, and a sync
// through what follows it.
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
// A call site names the action and passes its own input type, so a renamed
// key fails to typecheck rather than at run time. `untyped` is for the doors
// whose action is known only at run time: an Undo sent back to
// /api/actions/:name, and the intents a turn's run recorded. Either way the
// dispatcher checks the input. An Undo of what someone else did names them
// in `undoes`, which its events carry.
export type Dispatch = {
  <N extends ActionName>(name: N, input: ActionInput<N>, actor: Actor): Promise<Result<N>>;
  untyped(
    name: ActionName,
    input: unknown,
    actor: Actor,
    undoes?: Actor,
  ): Promise<{ undo: Call | null }>;
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
    undoes?: Actor,
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
