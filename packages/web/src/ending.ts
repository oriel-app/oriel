// Ending a workstream (decision 0028), from wherever the window offers it:
// its page's header, or a menu or a swipe on it in the sidebar or the Done
// page. Marking it done or reopening it goes at once; deleting asks first,
// saying how many threads go with it, and sends that count, which the server
// checks. What it did then shows, with Undo through the one path every Undo
// takes, in the one stack of Undo notes, running out as the others do. What
// else must reload once one ends is the app's to say (root.ts).
import { type Effect, errorOf, post, type Replied, undoing } from "./http.ts";
import { type Held, type Hold, holding, letGo as release, notHeld, undoMs } from "./undos.ts";
import type {
  Undoable,
  UndoView,
  WorkstreamDeletedView,
  WorkstreamEndedView,
  WorkstreamSummary,
} from "./view.ts";

// What was last done to a workstream: marked done or reopened, with how many
// threads came along, or deleted, with how many went; its name then, and the
// call that undoes it, or null when it can't be.
export type Ending = {
  kind: "done" | "reopened" | "deleted";
  workstreamId: string;
  name: string;
  threads: number;
  undo: UndoView | null;
};

export type EndingModel = {
  // The workstream the person asked to delete, until they confirm or cancel,
  // and how many threads they're told go with it.
  asking: { workstreamId: string; name: string; threads: number } | null;
  // The workstream with a request in flight, and whether it is a delete.
  pending: { workstreamId: string; deleting: boolean } | null;
  ended: Ending | null;
  // Whether what was done still shows, with its Undo: it runs out as every
  // Undo note does, though a deleted workstream's page still says it went.
  shown: boolean;
  // The times its countdown started; only the latest one's end hides it.
  countdown: number;
  // The removals already in the page's stack when it showed, by the version
  // each made: they sit above it, and any made later below, newest at the
  // bottom.
  above: readonly number[];
  held: Held;
  // What the last request said, when it failed.
  problem: string | null;
};

// The workstream as a list shows it: enough to name it and count its threads.
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
  above: [],
  held: notHeld,
  problem: null,
});

// How many threads a workstream has, in any state.
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
      // As a removal's Undo does, it lets go of the keyboard's hold.
      const [released, restarts] = letGo(model, "focus");
      return [
        {
          ...released,
          pending: { workstreamId: ended.workstreamId, deleting: false },
          problem: null,
        },
        [undoing(ended.undo, tag(ended.workstreamId, "undone", ended.name)), ...restarts],
      ];
    }
    case "undoHeld": {
      if (msg.held) return [{ ...model, held: { ...model.held, [msg.by]: true } }, []];
      return letGo(model, msg.by);
    }
    case "undoExpired": {
      if (msg.countdown !== model.countdown || holding(model.held)) return [model, []];
      return [{ ...model, shown: false }, []];
    }
    case "problemDismissed":
      return [{ ...model, problem: null }, []];
  }
}

const expiry = (countdown: number): Effect => ({
  type: "after",
  ms: undoMs,
  msg: { type: "ending", msg: { type: "undoExpired", countdown } },
});

// Once neither pointer nor keyboard holds it, what was done gets its full
// time again.
function letGo(model: EndingModel, by: Hold): [EndingModel, Effect[]] {
  const [held, restart] = release(model.held, by);
  if (!restart || !model.shown) return [{ ...model, held }, []];
  const countdown = model.countdown + 1;
  return [{ ...model, held, countdown }, [expiry(countdown)]];
}

// The server's answer, and what was done starting to run out once it shows,
// below the removals (`above`, by version) already in the page's stack.
export function endingAnswered(
  model: EndingModel,
  msg: Replied,
  above: readonly number[],
): [EndingModel, Effect[]] {
  const next = endingReplied(model, msg);
  if (next.countdown === model.countdown) return [next, []];
  return [{ ...next, above }, [expiry(next.countdown)]];
}

// The server's answer: what it did shows, with its Undo, and its countdown
// starts; an Undo that landed clears it; a refusal says why.
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

// Leaving a page: what was done, and what failed, stop showing, as a
// removal's Undo does; a request in flight still answers.
export const leftPage = (model: EndingModel): EndingModel => ({
  ...model,
  ended: null,
  shown: false,
  held: notHeld,
  problem: null,
});

// Whether the workstream is gone from where the window shows it: deleted, or
// being deleted, until its Undo brings it back.
export const deleted = (model: EndingModel, workstreamId: string): boolean =>
  (model.pending?.deleting === true && model.pending.workstreamId === workstreamId) ||
  (model.ended?.kind === "deleted" && model.ended.workstreamId === workstreamId);

// The removals in the page's stack either side of what was done: those made
// before it, above it, and those since, below, newest at the bottom.
export function around<T extends { version: number }>(
  model: EndingModel,
  removals: readonly T[],
): [T[], T[]] {
  const before = (each: T) => model.above.includes(each.version);
  return [removals.filter(before), removals.filter((each) => !before(each))];
}

// "2 of its threads", or "its thread", as what came along with the workstream.
const its = (threads: number) => (threads === 1 ? "its thread" : `${threads} of its threads`);

// What was last done to a workstream, in a sentence.
export function endedText(ended: Pick<Ending, "kind" | "name" | "threads">): string {
  const { kind, name, threads } = ended;
  if (kind === "deleted")
    return threads === 0
      ? `Deleted “${name}”.`
      : `Deleted “${name}”, with ${threads === 1 ? "its thread" : `its ${threads} threads`}.`;
  const did = kind === "done" ? `Marked “${name}” done` : `Reopened “${name}”`;
  return threads === 0 ? `${did}.` : `${did}, with ${its(threads)}.`;
}

// What the person is told before deleting: how many threads go with it, and
// that its items stay where they are.
export function deleteWarning(threads: number): string {
  const after = " Its items stay in their sources. You can undo this right after.";
  if (threads === 0) return "It has no threads. Its items stay in their sources.";
  return `${threads === 1 ? "Its thread goes" : `Its ${threads} threads go`} with it, out of the sidebar, Needs you, the Done page and search.${after}`;
}
