// A workstream's page: its members, its threads, and asking about it, which
// opens a thread. Items are added from the window, or dropped here, and
// removed here, each removal undoable for a few seconds.
import { type Dropped, type DropReply, dropNotice, isEmpty } from "./drop.ts";
import { type Effect, errorOf, get, post, type Replied } from "./http.ts";
import type { WorkstreamSummary, WorkstreamView, MemberView, Undoable, UndoView } from "./view.ts";

// A removal the user can still undo: the member as it showed, the workstream
// version the removal made, which tells it from every other, and the call
// that undoes it, as the server gave it, or null when it can't be undone.
// `countdown` counts the times its countdown started; only the latest one's
// end hides it.
export type Removal = {
  member: MemberView;
  version: number;
  countdown: number;
  undo: UndoView | null;
};

// How long a removal can be undone, while the user isn't on its Undo.
export const undoMs = 8_000;

export type WorkstreamModel = {
  id: string;
  view: WorkstreamView | null;
  status: "loading" | "ready" | "failed";
  draft: string;
  // The name being edited, or null.
  name: string | null;
  pending: boolean;
  notice: string | null;
  // Members removed with ×, hidden at once, in order: the first is being
  // removed, and the rest wait for it, so each answer is known to be its own.
  // `member` is null when the page hadn't loaded it.
  removing: readonly { id: string; member: MemberView | null }[];
  // Removals that can still be undone, oldest first.
  removals: readonly Removal[];
  // The user is on the undos, by pointer or keyboard: none runs out meanwhile.
  held: Readonly<Record<Hold, boolean>>;
};

export type Hold = "pointer" | "focus";

export type WorkstreamMsg =
  | { type: "draftChanged"; text: string }
  | { type: "askClicked" }
  | { type: "memberRemoved"; id: string }
  | { type: "undoClicked"; version: number }
  | { type: "undoHeld"; by: Hold; held: boolean }
  | { type: "undoExpired"; workstreamId: string; version: number; countdown: number }
  | { type: "nameEdited"; name: string }
  | { type: "nameSaved" }
  | { type: "addClicked" }
  | { type: "dropped"; dropped: Dropped };

export function initWorkstream(id: string): [WorkstreamModel, Effect[]] {
  return [
    {
      id,
      view: null,
      status: "loading",
      draft: "",
      name: null,
      pending: false,
      notice: null,
      removing: [],
      removals: [],
      held: { pointer: false, focus: false },
    },
    [get(`/api/workstreams/${id}`, { kind: "workstream", id })],
  ];
}

export function updateWorkstream(
  model: WorkstreamModel,
  msg: WorkstreamMsg,
): [WorkstreamModel, Effect[]] {
  switch (msg.type) {
    case "draftChanged":
      return [{ ...model, draft: msg.text }, []];
    case "askClicked": {
      const text = model.draft.trim();
      if (text === "" || model.pending) return [model, []];
      return [
        { ...model, pending: true, notice: null },
        [
          post(
            `/api/workstreams/${model.id}/threads`,
            { text },
            { kind: "threadOpened", workstreamId: model.id },
          ),
        ],
      ];
    }
    case "memberRemoved": {
      if (model.removing.some((each) => each.id === msg.id)) return [model, []];
      const member = model.view?.members.find((each) => each.ref.id === msg.id) ?? null;
      return [
        { ...model, removing: [...model.removing, { id: msg.id, member }], notice: null },
        model.removing.length === 0 ? [removal(model.id, msg.id)] : [],
      ];
    }
    case "undoClicked": {
      const undone = model.removals.find((each) => each.version === msg.version);
      if (!undone?.undo) return [model, []];
      // Its Undo goes, and with it, maybe without a word, the focus that held
      // the rest: the keyboard lets go of them. A pointer still on them holds.
      const [held, rest, restarts] = letGo(
        model,
        "focus",
        model.removals.filter((each) => each !== undone),
      );
      return [
        { ...model, held, removals: rest, notice: null },
        [
          post(`/api/actions/${undone.undo.action}`, undone.undo.input, {
            kind: "restored",
            id: model.id,
          }),
          ...restarts,
        ],
      ];
    }
    case "undoHeld": {
      if (msg.held) return [{ ...model, held: { ...model.held, [msg.by]: true } }, []];
      const [held, removals, restarts] = letGo(model, msg.by, model.removals);
      return [{ ...model, held, removals }, restarts];
    }
    case "undoExpired": {
      if (msg.workstreamId !== model.id || holding(model.held)) return [model, []];
      const removals = model.removals.filter(
        (each) => each.version !== msg.version || each.countdown !== msg.countdown,
      );
      return removals.length === model.removals.length ? [model, []] : [{ ...model, removals }, []];
    }
    case "nameEdited":
      return [{ ...model, name: msg.name }, []];
    case "nameSaved": {
      const name = model.name?.trim();
      if (!name || name === model.view?.workstream.name) return [{ ...model, name: null }, []];
      return [
        { ...model, name: null },
        [post(`/api/workstreams/${model.id}/rename`, { name }, { kind: "renamed", id: model.id })],
      ];
    }
    case "addClicked":
      return [
        model,
        [{ type: "navigate", route: { page: "window", grouping: "epic", addTo: model.id } }],
      ];
    case "dropped":
      if (isEmpty(msg.dropped)) return [{ ...model, notice: nothingToAdd }, []];
      return [
        { ...model, notice: null },
        [
          post(`/api/workstreams/${model.id}/drop`, msg.dropped, {
            kind: "dropped",
            workstreamId: model.id,
          }),
        ],
      ];
  }
}

const removal = (workstreamId: string, id: string): Effect =>
  post(
    `/api/workstreams/${workstreamId}/remove`,
    { items: [id] },
    { kind: "workstreamChanged", id: workstreamId },
  );

const expiry = (workstreamId: string, { version, countdown }: Removal): Effect => ({
  type: "after",
  ms: undoMs,
  msg: { type: "workstream", msg: { type: "undoExpired", workstreamId, version, countdown } },
});

const holding = (held: WorkstreamModel["held"]): boolean => held.pointer || held.focus;

// Once neither pointer nor keyboard holds them, every removal held gets its
// full time again.
function letGo(
  model: WorkstreamModel,
  by: Hold,
  removals: readonly Removal[],
): [WorkstreamModel["held"], Removal[], Effect[]] {
  const held = { ...model.held, [by]: false };
  if (!holding(model.held) || holding(held)) return [held, [...removals], []];
  const restarted = removals.map((each) => ({ ...each, countdown: each.countdown + 1 }));
  return [held, restarted, restarted.map((each) => expiry(model.id, each))];
}

// The server says what can be undone: only an item the window still has can
// be added back.
export const undoable = (removal: Removal): boolean => removal.undo !== null;

// What ⌘Z or Ctrl+Z undoes: the latest removal that can be.
export const latestUndo = (model: WorkstreamModel): Removal | null =>
  model.removals.findLast(undoable) ?? null;

// A reply's view, unless one already shown is newer: answers to a removal and
// to an undo can cross.
const newer = (model: WorkstreamModel, view: WorkstreamView): WorkstreamView =>
  model.view && model.view.workstream.version > view.workstream.version ? model.view : view;

export const nothingToAdd = "Nothing that was dropped names an item. Drop a Jira item or a file.";

export function workstreamReplied(
  model: WorkstreamModel,
  msg: Replied,
): [WorkstreamModel, Effect[]] {
  const { tag } = msg;
  switch (tag.kind) {
    case "workstreamChanged": {
      if (tag.id !== model.id) return [model, []];
      // The first removal waiting is the one answered, and the next goes now;
      // unless the answer still holds it, as one to a removal sent before
      // the page was opened again does.
      const [done, ...rest] = model.removing;
      const next = rest[0] ? [removal(model.id, rest[0].id)] : [];
      if (!msg.ok) return [{ ...model, removing: rest, notice: errorOf(msg.body) }, next];
      const { undo: call, ...answer } = msg.body as Undoable<WorkstreamView>;
      if (done && answer.members.some((each) => each.ref.id === done.id))
        return [{ ...model, view: newer(model, answer), status: "ready" }, []];
      const view = newer(model, answer);
      const undo = done?.member
        ? { member: done.member, version: answer.workstream.version, countdown: 0, undo: call }
        : null;
      return [
        {
          ...model,
          view,
          status: "ready",
          removing: rest,
          removals: undo ? [...model.removals, undo] : model.removals,
        },
        [...next, ...(undo ? [expiry(model.id, undo)] : [])],
      ];
    }
    // The undo landed: the workstream, as it is now, loads again.
    case "restored": {
      if (tag.id !== model.id) return [model, []];
      if (!msg.ok) return [{ ...model, notice: errorOf(msg.body) }, []];
      return [model, [get(`/api/workstreams/${model.id}`, { kind: "workstream", id: model.id })]];
    }
    case "workstream": {
      if (tag.id !== model.id) return [model, []];
      if (!msg.ok)
        return [
          { ...model, status: model.view ? "ready" : "failed", notice: errorOf(msg.body) },
          [],
        ];
      return [{ ...model, view: newer(model, msg.body as WorkstreamView), status: "ready" }, []];
    }
    // Loaded again after the workspace changed, maybe in another tab, which
    // may have deleted it: the page says why it can't go on.
    case "workstreamSynced":
      if (tag.id !== model.id) return [model, []];
      if (!msg.ok) return [{ ...model, notice: errorOf(msg.body) }, []];
      return [{ ...model, view: newer(model, msg.body as WorkstreamView), status: "ready" }, []];
    case "renamed": {
      if (tag.id !== model.id || model.view === null) return [model, []];
      if (!msg.ok) return [{ ...model, notice: errorOf(msg.body) }, []];
      return [{ ...model, view: { ...model.view, workstream: msg.body as WorkstreamSummary } }, []];
    }
    case "dropped": {
      if (tag.workstreamId !== model.id) return [model, []];
      if (!msg.ok) return [{ ...model, notice: errorOf(msg.body) }, []];
      const reply = msg.body as DropReply;
      return [{ ...model, view: newer(model, reply.workstream), notice: dropNotice(reply) }, []];
    }
    case "threadOpened": {
      if (tag.workstreamId !== model.id) return [model, []];
      if (!msg.ok) return [{ ...model, pending: false, notice: errorOf(msg.body) }, []];
      const { id } = msg.body as { id: string };
      return [
        { ...model, pending: false, draft: "" },
        [{ type: "navigate", route: { page: "thread", id } }],
      ];
    }
    default:
      return [model, []];
  }
}

// What a workstream or thread with no items asks for: there is nothing to ask
// about, so the agent can only create items, as when planning an epic.
export const planPrompt =
  "What are you planning? Describe it, and ask for an epic and its stories…";

// The workstream page's ask box, worded for how many items the workstream has.
export function askPrompt(size: number): string {
  if (size === 0) return planPrompt;
  if (size === 1) return "Ask about this item…";
  return `Ask about these ${size} items…`;
}
