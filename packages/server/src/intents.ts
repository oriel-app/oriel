// They apply only in a turn the user started.
import {
  type ActionLine,
  type Actor,
  type Call,
  type Intent,
  type ItemId,
  planned,
  type Thread,
  type Touched,
  type Instant,
  type Ulid,
} from "@oriel/core";
import type { ThreadStore, WorkstreamStore } from "@oriel/db";
import { ActionError, type Dispatch } from "./actions.ts";
import { agentEvent } from "./agent.ts";

export type IntentDeps = {
  dispatch: Dispatch;
  workstreams: WorkstreamStore;
  title(threadId: Ulid): string | null;
  startedBy(threadId: Ulid): Actor | null;
};

export type LinePlace = { thread: Ulid; seq: number; index: number };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const text = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function intentsOf(deps: IntentDeps) {
  const touched = (call: Intent, made: unknown): Touched => {
    const { input } = call;
    const id = (value: unknown) => (typeof value === "string" ? (value as Ulid) : null);
    const workstream = id(input["workstream"]) ?? id(made);
    if (workstream !== null || call.action.startsWith("workstream.")) {
      const name = workstream && deps.workstreams.get(workstream)?.name;
      return {
        kind: "workstream",
        id: workstream && name !== undefined ? workstream : null,
        name: name ?? (typeof input["name"] === "string" ? input["name"] : null),
      };
    }
    const thread = id(input["thread"]);
    return { kind: "thread", id: thread, name: thread && deps.title(thread) };
  };

  return {
    async apply(
      turn: { thread: Thread; changeSetId: Ulid | null },
      intents: readonly Intent[],
    ): Promise<ActionLine[]> {
      const { thread } = turn;
      const actor: Actor = { kind: "agent", threadId: thread.id };
      const theirs = deps.startedBy(thread.id)?.kind === "user";
      const lines: ActionLine[] = [];
      for (const call of planned(intents, { thread: thread.id })) {
        const refused = (why: string): ActionLine => ({
          call,
          touched: touched(call, null),
          applied: false,
          why,
        });
        if (!theirs) {
          lines.push(refused("this turn wasn't started by you, so Oriel applied none of it"));
          continue;
        }
        if (
          call.action === "thread.done" &&
          call.input["thread"] === thread.id &&
          turn.changeSetId
        ) {
          lines.push(refused("this turn proposed a change set, which waits on you"));
          continue;
        }
        try {
          const done = await deps.dispatch.untyped(call.action, call.input, actor);
          const { workstream: made, gone } = done as { workstream?: unknown; gone?: ItemId[] };
          lines.push({
            call,
            touched: touched(call, made),
            applied: true,
            undo: done.undo,
            ...(gone?.length ? { gone } : {}),
          });
        } catch (error) {
          lines.push(
            refused(error instanceof ActionError ? text(error) : `Oriel failed: ${text(error)}`),
          );
        }
      }
      return lines;
    },
  };
}

export type LineUndoDeps = {
  dispatch: Dispatch;
  threads: ThreadStore;
  workspaceId: Ulid;
  rewritten(threadId: Ulid, own: boolean): void;
  now(): Instant;
};

export function lineUndo(deps: LineUndoDeps) {
  // Lines with an Undo or redo in flight, so a second click waits for it.
  const undoing = new Set<string>();

  const lineAt = (at: LinePlace) => {
    const thread = deps.threads.get(at.thread, deps.now());
    const [message] =
      thread?.workspaceId === deps.workspaceId ? deps.threads.messages(thread.id, at.seq - 1) : [];
    const event =
      message?.seq === at.seq && message.role === "agent" ? agentEvent(message.event) : null;
    const list = event?.ok && event.value.kind === "actions" ? event.value : null;
    const line = list?.lines[at.index];
    if (!list || !line?.applied)
      throw new ActionError("not-found", "no such line under the agent's reply");
    return { list, line };
  };

  return async function undo(
    at: LinePlace,
    call: Call,
    actor: Actor,
  ): Promise<{ undo: Call | null }> {
    const { line } = lineAt(at);
    const undone = line.since?.undone === true;
    const offered = line.since ? line.since.next : line.undo;
    // `call` must be what the line offers now, so each click does it once.
    if (!offered || !same(offered, call))
      throw new ActionError(
        "refused",
        undone ? "it was already undone" : "it was already done again",
      );
    const key = `${at.thread}:${at.seq}:${at.index}`;
    if (undoing.has(key)) throw new ActionError("refused", "it is being undone already");
    undoing.add(key);
    try {
      // A redo undoes the user's own Undo.
      const undoes: Actor = undone ? actor : { kind: "agent", threadId: at.thread };
      const { undo } = await deps.dispatch.untyped(
        offered.action,
        offered.input,
        actor,
        undoes,
        at.thread,
      );
      // As stored now: another of its lines may have changed meanwhile.
      const { list } = lineAt(at);
      const lines = list.lines.map((each, i) =>
        i === at.index && each.applied ? { ...each, since: { undone: !undone, next: undo } } : each,
      );
      deps.threads.rewrite(at.thread, at.seq, { ...list, lines });
      const changed = (offered.input as { workstream?: unknown }).workstream;
      deps.rewritten(at.thread, changed === deps.threads.get(at.thread, deps.now())?.workstreamId);
      return { undo };
    } finally {
      undoing.delete(key);
    }
  };
}
