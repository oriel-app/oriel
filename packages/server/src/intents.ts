// What becomes of a turn's intents (decision 0024), once its change set is
// captured: the calls they plan out as (`planned`) go through the one
// dispatcher, in order, as the thread's agent, and each comes back as a line
// the host shows under the agent's reply: applied, with its Undo, or refused,
// and why. They apply only in a turn the user started.
import {
  type ActionLine,
  type Actor,
  type Intent,
  planned,
  type Thread,
  type Touched,
  type Ulid,
} from "@oriel/core";
import type { WorkstreamStore } from "@oriel/db";
import { ActionError, type Dispatch } from "./actions.ts";

export type IntentDeps = {
  dispatch: Dispatch;
  workstreams: WorkstreamStore;
  // A thread's title as the window shows it, or null before it has one.
  title(threadId: Ulid): string | null;
  // Who started the thread's turn now running: the user, whose message it
  // answers, or a message they sent on (decision 0024).
  startedBy(threadId: Ulid): Actor | null;
};

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
