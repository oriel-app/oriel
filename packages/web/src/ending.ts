import { type Effect, errorOf, post, type Replied, undoing } from "./http.ts";
import type { Msg } from "./root.ts";
import { expiry, type Held, type Hold, hold, notHeld, restart, runsOut } from "./undos.ts";
import type {
  Undoable,
  UndoView,
  WorkstreamDeletedView,
  WorkstreamEndedView,
  WorkstreamSummary,
} from "./view.ts";

export type Ending = {
  kind: "done" | "reopened" | "deleted";
  workstreamId: string;
  name: string;
  threads: number;
  undo: UndoView | null;
};

export type EndingModel = {
  asking: { workstreamId: string; name: string; threads: number } | null;
  pending: { workstreamId: string; deleting: boolean } | null;
  ended: Ending | null;
  shown: boolean;
  countdown: number;
  held: Held;
  problem: string | null;
};

export type Ended = Pick<WorkstreamSummary, "id" | "name" | "threads">;

export type EndingMsg =
  | { type: "markDoneClicked"; workstream: Ended }
  | { type: "reopenClicked"; workstream: Ended }
  | { type: "deleteClicked"; workstream: Ended }
  | { type: "deleteConfirmed" }
  | { type: "deleteCancelled" }
  | { type: "undoClicked" }
  | { type: "undoHeld"; by: Hold; held: boolean }
  | { type: "undoExpired"; countdown: number }
  | { type: "problemDismissed" };

export const initEnding = (): EndingModel => ({
  asking: null,
  pending: null,
  ended: null,
  shown: false,
  countdown: 0,
  held: notHeld,
  problem: null,
});

export const threadCount = (workstream: Ended): number =>
  Object.values(workstream.threads).reduce((a, b) => a + b, 0);

const tag = (workstreamId: string, how: Ending["kind"] | "undone", name: string) =>
  ({ kind: "ended", id: workstreamId, how, name }) as const;

export function updateEnding(model: EndingModel, msg: EndingMsg): [EndingModel, Effect[]] {
  switch (msg.type) {
    case "markDoneClicked":
    case "reopenClicked": {
      if (model.pending) return [model, []];
      const { id, name } = msg.workstream;
      const how = msg.type === "markDoneClicked" ? "done" : "reopened";
      const url = `/api/workstreams/${id}/${how === "done" ? "done" : "reopen"}`;
      return [
        { ...model, pending: { workstreamId: id, deleting: false }, problem: null },
        [post(url, {}, tag(id, how, name))],
      ];
    }
    case "deleteClicked": {
      if (model.pending) return [model, []];
      const { id, name } = msg.workstream;
      const asking = { workstreamId: id, name, threads: threadCount(msg.workstream) };
      return [{ ...model, asking, problem: null }, []];
    }
    case "deleteConfirmed": {
      const { asking } = model;
      if (asking === null || model.pending) return [model, []];
      return [
        { ...model, pending: { workstreamId: asking.workstreamId, deleting: true } },
        [
          post(
            `/api/workstreams/${asking.workstreamId}/delete`,
            { threads: asking.threads },
            tag(asking.workstreamId, "deleted", asking.name),
          ),
        ],
      ];
    }
    case "deleteCancelled":
      return [{ ...model, asking: null, problem: null }, []];
    case "undoClicked": {
      const { ended } = model;
      if (!ended?.undo || !model.shown || model.pending) return [model, []];
      const [released, restarts] = hold(model, "focus", false, again);
      return [
        {
          ...released,
          pending: { workstreamId: ended.workstreamId, deleting: false },
          problem: null,
        },
        [undoing(ended.undo, tag(ended.workstreamId, "undone", ended.name)), ...restarts],
      ];
    }
    case "undoHeld":
      return hold(model, msg.by, msg.held, again);
    case "undoExpired": {
      if (!runsOut(model, msg.countdown)) return [model, []];
      return [{ ...model, shown: false }, []];
    }
    case "problemDismissed":
      return [{ ...model, problem: null }, []];
  }
}

const expired = (countdown: number): Msg => ({
  type: "ending",
  msg: { type: "undoExpired", countdown },
});

const again = (model: EndingModel): [EndingModel, Effect[]] =>
  model.shown ? restart(model, expired) : [model, []];

export function endingAnswered(model: EndingModel, msg: Replied): [EndingModel, Effect[]] {
  const next = endingReplied(model, msg);
  if (next.countdown === model.countdown) return [next, []];
  return [next, [expiry(expired(next.countdown))]];
}

export function endingReplied(model: EndingModel, msg: Replied): EndingModel {
  const { tag } = msg;
  if (tag.kind !== "ended") return model;
  const base = { ...model, pending: null, asking: null };
  if (!msg.ok) return { ...base, problem: errorOf(msg.body) };
  if (tag.how === "undone") return { ...base, ended: null, problem: null };
  const { undo, threads } =
    tag.how === "deleted"
      ? (msg.body as Undoable<WorkstreamDeletedView>)
      : (() => {
          const body = msg.body as Undoable<WorkstreamEndedView>;
          return { undo: body.undo, threads: body.carried };
        })();
  return {
    ...base,
    problem: null,
    ended: { kind: tag.how, workstreamId: tag.id, name: tag.name, threads, undo },
    shown: true,
    countdown: model.countdown + 1,
  };
}

export const leftPage = (model: EndingModel): EndingModel => ({
  ...model,
  ended: null,
  shown: false,
  held: notHeld,
  problem: null,
});

export const deleted = (model: EndingModel, workstreamId: string): boolean =>
  (model.pending?.deleting === true && model.pending.workstreamId === workstreamId) ||
  (model.ended?.kind === "deleted" && model.ended.workstreamId === workstreamId);

const its = (threads: number) => (threads === 1 ? "its thread" : `${threads} of its threads`);

export function endedText(ended: Pick<Ending, "kind" | "name" | "threads">): string {
  const { kind, name, threads } = ended;
  if (kind === "deleted")
    return threads === 0
      ? `Deleted “${name}”.`
      : `Deleted “${name}”, with ${threads === 1 ? "its thread" : `its ${threads} threads`}.`;
  const did = kind === "done" ? `Marked “${name}” done` : `Reopened “${name}”`;
  return threads === 0 ? `${did}.` : `${did}, with ${its(threads)}.`;
}

export function deleteWarning(threads: number): string {
  const after = " Its items stay in their sources. You can undo this right after.";
  if (threads === 0) return "It has no threads. Its items stay in their sources.";
  return `${threads === 1 ? "Its thread goes" : `Its ${threads} threads go`} with it, out of the sidebar, Needs you, the Done page and search.${after}`;
}
