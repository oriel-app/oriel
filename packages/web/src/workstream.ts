import { type Dropped, type DropReply, dropNotice, isEmpty } from "./drop.ts";
import { type Effect, errorOf, get, post, reached, type Replied, undoing } from "./http.ts";
import {
  aboutOf,
  looked,
  type LookingAt,
  type LookingMsg,
  notLooking,
  lookingReported,
  updateLooking,
} from "./looking.ts";
import type { Msg } from "./root.ts";
import { expiry, type Held, type Hold, hold, holding, notHeld, undoMs } from "./undos.ts";
import type { WorkstreamSummary, WorkstreamView, MemberView, Undoable, UndoView } from "./view.ts";

export { undoMs };

// `countdown` counts the times its countdown started; only the latest one's end hides it.
export type Removal = {
  member: MemberView;
  version: number;
  countdown: number;
  undo: UndoView | null;
};

export type WorkstreamModel = {
  id: string;
  view: WorkstreamView | null;
  status: "loading" | "ready" | "failed";
  draft: string;
  lookingAt: LookingAt;
  name: string | null;
  pending: boolean;
  notice: string | null;
  lost: string | null;
  // The first is being removed, and the rest wait for it, so each answer is known to be its own.
  removing: readonly { id: string; member: MemberView | null }[];
  removals: readonly Removal[];
  suggested: readonly MemberView[];
  held: Held;
};

export type WorkstreamMsg =
  | { type: "draftChanged"; text: string }
  | { type: "askClicked" }
  | { type: "looking"; msg: LookingMsg }
  | { type: "memberRemoved"; id: string }
  | { type: "undoClicked"; version: number }
  | { type: "toolUndoClicked"; version: number }
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
      lookingAt: notLooking,
      name: null,
      pending: false,
      notice: null,
      lost: null,
      removing: [],
      removals: [],
      suggested: [],
      held: notHeld,
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
    case "looking":
      return [
        { ...model, lookingAt: updateLooking(model.lookingAt, msg.msg) },
        lookingReported(msg.msg),
      ];
    case "askClicked": {
      const text = model.draft.trim();
      if (text === "" || model.pending) return [model, []];
      return [
        { ...model, pending: true, notice: null },
        [
          post(
            `/api/workstreams/${model.id}/threads`,
            { text, about: aboutOf(model.lookingAt) },
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
      // Its Undo goes, and with it, maybe without a word, the focus that held the rest. A pointer still on them holds.
      const rest = model.removals.filter((each) => each !== undone);
      const [released, restarts] = hold({ ...model, removals: rest }, "focus", false, again);
      return [
        { ...released, notice: null },
        [undoing(undone.undo, { kind: "restored", id: model.id }), ...restarts],
      ];
    }
    case "toolUndoClicked": {
      const undo = model.view?.changes.find((each) => each.version === msg.version)?.undo;
      if (!undo) return [model, []];
      return [{ ...model, notice: null }, [undoing(undo, { kind: "restored", id: model.id })]];
    }
    case "undoHeld":
      return hold(model, msg.by, msg.held, again);
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

const expired = (workstreamId: string, { version, countdown }: Removal): Msg => ({
  type: "workstream",
  msg: { type: "undoExpired", workstreamId, version, countdown },
});

function again(model: WorkstreamModel): [WorkstreamModel, Effect[]] {
  const removals = model.removals.map((each) => ({ ...each, countdown: each.countdown + 1 }));
  return [{ ...model, removals }, removals.map((each) => expiry(expired(model.id, each)))];
}

export const undoable = (removal: Removal): boolean => removal.undo !== null;

// A reply's view, unless one already shown is newer: answers to a removal and
// to an undo can cross.
const newer = (model: WorkstreamModel, view: WorkstreamView): WorkstreamView =>
  model.view && model.view.workstream.version > view.workstream.version ? model.view : view;

function viewed(
  model: WorkstreamModel,
  answer: WorkstreamView,
): Pick<WorkstreamModel, "view" | "suggested"> {
  const view = newer(model, answer);
  if (view.suggested) return { view, suggested: view.suggested };
  const kept = new Set(model.suggested.map((each) => each.ref.id));
  const fromThem = view.members.every((member) => kept.has(member.ref.id));
  return { view, suggested: fromThem ? model.suggested : [] };
}

function loaded(model: WorkstreamModel, msg: Replied): WorkstreamModel {
  if (!msg.ok) {
    const lost = errorOf(msg.body);
    return { ...model, status: model.view ? "ready" : "failed", notice: lost, lost };
  }
  const notice = model.notice === model.lost ? null : reached(model.notice);
  return {
    ...model,
    ...viewed(model, msg.body as WorkstreamView),
    status: "ready",
    notice,
    lost: null,
  };
}

export const nothingToAdd =
  "Nothing that was dropped names an item. Drop an item, or a link to one.";

export function workstreamReplied(
  model: WorkstreamModel,
  msg: Replied,
): [WorkstreamModel, Effect[]] {
  const { tag } = msg;
  switch (tag.kind) {
    case "workstreamChanged": {
      if (tag.id !== model.id) return [model, []];
      // A reply that still holds the first removal, as one to a removal sent before the page was opened again,
      // leaves it waiting.
      const [done, ...rest] = model.removing;
      const next = rest[0] ? [removal(model.id, rest[0].id)] : [];
      if (!msg.ok) return [{ ...model, removing: rest, notice: errorOf(msg.body) }, next];
      const { undo: call, ...answer } = msg.body as Undoable<WorkstreamView>;
      if (done && answer.members.some((each) => each.ref.id === done.id))
        return [{ ...model, ...viewed(model, answer), status: "ready" }, []];
      const undo = done?.member
        ? { member: done.member, version: answer.workstream.version, countdown: 0, undo: call }
        : null;
      return [
        {
          ...model,
          ...viewed(model, answer),
          status: "ready",
          removing: rest,
          removals: undo ? [...model.removals, undo] : model.removals,
        },
        [...next, ...(undo ? [expiry(expired(model.id, undo))] : [])],
      ];
    }
    case "restored": {
      if (tag.id !== model.id) return [model, []];
      if (!msg.ok) return [{ ...model, notice: errorOf(msg.body) }, []];
      return [model, [get(`/api/workstreams/${model.id}`, { kind: "workstream", id: model.id })]];
    }
    case "workstream":
    case "workstreamSynced":
      if (tag.id !== model.id) return [model, []];
      return [loaded(model, msg), []];
    case "renamed": {
      if (tag.id !== model.id || model.view === null) return [model, []];
      if (!msg.ok) return [{ ...model, notice: errorOf(msg.body) }, []];
      return [{ ...model, view: { ...model.view, workstream: msg.body as WorkstreamSummary } }, []];
    }
    case "dropped": {
      if (tag.workstreamId !== model.id) return [model, []];
      if (!msg.ok) return [{ ...model, notice: errorOf(msg.body) }, []];
      const reply = msg.body as DropReply;
      return [{ ...model, ...viewed(model, reply.workstream), notice: dropNotice(reply) }, []];
    }
    case "threadOpened": {
      if (tag.workstreamId !== model.id) return [model, []];
      if (!msg.ok) return [{ ...model, pending: false, notice: errorOf(msg.body) }, []];
      const { id } = msg.body as { id: string };
      return [
        { ...model, pending: false, draft: "", lookingAt: looked(model.lookingAt) },
        [{ type: "navigate", route: { page: "thread", id } }],
      ];
    }
    default:
      return [model, []];
  }
}

export const planPrompt =
  "What are you planning? Describe it, and ask for an epic and its stories…";

export function askPrompt(size: number): string {
  if (size === 0) return planPrompt;
  if (size === 1) return "Ask about this item…";
  return `Ask about these ${size} items…`;
}
