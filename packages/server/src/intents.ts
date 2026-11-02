// What becomes of a turn's intents (decision 0024), once its change set is
// captured: the calls they plan out as (`planned`) go through the one
// dispatcher, in order, as the thread's agent, and each comes back as a line
// the host shows under the agent's reply: applied, with its Undo, or refused,
// and why. They apply only in a turn the user started. The user's Undo of a
// line, and their redo of it, go through the same dispatcher, and the line
// then says so.
import {
  type ActionLine,
  type Actor,
  type Call,
  type Intent,
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
  // A thread's title as the window shows it, or null before it has one.
  title(threadId: Ulid): string | null;
  // Who started the thread's turn now running: the user, whose message it
  // answers, or a message they sent on (decision 0024).
  startedBy(threadId: Ulid): Actor | null;
};

// A line under the agent's reply, by its place: the thread, the list's seq in
// its chat, and the line's index in the list.
export type LinePlace = { thread: Ulid; seq: number; index: number };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const text = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function intentsOf(deps: IntentDeps) {
  // What a call touches, named as it is now: a workstream it names, or the
  // one it made, or else the thread.
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
          const made = (done as { workstream?: unknown }).workstream;
          lines.push({ call, touched: touched(call, made), applied: true, undo: done.undo });
        } catch (error) {
          // What didn't apply says why, and what did keeps its line.
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
  // An entry already in the thread's chat changed: its pages reload it.
  // `own`: what changed was the thread's own workstream, which it catches up
  // with, as it would on the user's message.
  rewritten(threadId: Ulid, own: boolean): void;
  now(): Instant;
};

export function lineUndo(deps: LineUndoDeps) {
  // Lines with an Undo or redo in flight, so a second click waits for it.
  const undoing = new Set<string>();

  // The user's Undo of the line at `at`, or their redo of one they undid:
  // `call` must be what it offers now, so each click does it once. It
  // runs as the user's, naming whose action it undoes, and the line
  // keeps what comes of it: undone, with the call that does it again, or
  // done again, with its Undo.
  // The list at `at`, as stored now, and its line there that applied.
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
      const { undo } = await deps.dispatch.untyped(offered.action, offered.input, actor, undoes);
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
