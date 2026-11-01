// A group's page: its members, its threads, and asking about it, which
// opens a thread. Items are added from the window, or dropped here, and
// removed here, each removal undoable for a few seconds.
import { type Dropped, type DropReply, dropNotice, isEmpty } from "./drop.ts";
import { type Effect, errorOf, get, post, type Replied } from "./http.ts";
import type { GroupSummary, GroupView, MemberView } from "./view.ts";

// A removal the user can still undo: the member as it showed, and the group
// version the removal made, which tells it from every other. `countdown`
// counts the times its countdown started; only the latest one's end hides it.
export type Removal = { member: MemberView; version: number; countdown: number };

// How long a removal can be undone, while the user isn't on its Undo.
export const undoMs = 8_000;

export type GroupModel = {
  id: string;
  view: GroupView | null;
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

export type GroupMsg =
  | { type: "draftChanged"; text: string }
  | { type: "askClicked" }
  | { type: "memberRemoved"; id: string }
  | { type: "undoClicked"; version: number }
  | { type: "undoHeld"; by: Hold; held: boolean }
  | { type: "undoExpired"; groupId: string; version: number; countdown: number }
  | { type: "nameEdited"; name: string }
  | { type: "nameSaved" }
  | { type: "addClicked" }
  | { type: "dropped"; dropped: Dropped };

export function initGroup(id: string): [GroupModel, Effect[]] {
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
    [get(`/api/groups/${id}`, { kind: "group", id })],
  ];
}

export function updateGroup(model: GroupModel, msg: GroupMsg): [GroupModel, Effect[]] {
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
            `/api/groups/${model.id}/threads`,
            { text },
            { kind: "threadOpened", groupId: model.id },
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
      if (undone === undefined || !undoable(undone)) return [model, []];
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
          post(
            `/api/groups/${model.id}/add`,
            { items: [undone.member.ref.id] },
            { kind: "restored", id: model.id },
          ),
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
      if (msg.groupId !== model.id || holding(model.held)) return [model, []];
      const removals = model.removals.filter(
        (each) => each.version !== msg.version || each.countdown !== msg.countdown,
      );
      return removals.length === model.removals.length ? [model, []] : [{ ...model, removals }, []];
    }
    case "nameEdited":
      return [{ ...model, name: msg.name }, []];
    case "nameSaved": {
      const name = model.name?.trim();
      if (!name || name === model.view?.group.name) return [{ ...model, name: null }, []];
      return [
        { ...model, name: null },
        [post(`/api/groups/${model.id}/rename`, { name }, { kind: "renamed", id: model.id })],
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
        [post(`/api/groups/${model.id}/drop`, msg.dropped, { kind: "dropped", groupId: model.id })],
      ];
  }
}

const removal = (groupId: string, id: string): Effect =>
  post(`/api/groups/${groupId}/remove`, { items: [id] }, { kind: "groupChanged", id: groupId });

const expiry = (groupId: string, { version, countdown }: Removal): Effect => ({
  type: "after",
  ms: undoMs,
  msg: { type: "group", msg: { type: "undoExpired", groupId, version, countdown } },
});

const holding = (held: GroupModel["held"]): boolean => held.pointer || held.focus;

// Once neither pointer nor keyboard holds them, every removal held gets its
// full time again.
function letGo(
  model: GroupModel,
  by: Hold,
  removals: readonly Removal[],
): [GroupModel["held"], Removal[], Effect[]] {
  const held = { ...model.held, [by]: false };
  if (!holding(model.held) || holding(held)) return [held, [...removals], []];
  const restarted = removals.map((each) => ({ ...each, countdown: each.countdown + 1 }));
  return [held, restarted, restarted.map((each) => expiry(model.id, each))];
}

// Only an item the window still has can be added back.
export const undoable = (removal: Removal): boolean => removal.member.row !== null;

// What ⌘Z or Ctrl+Z undoes: the latest removal that can be.
export const latestUndo = (model: GroupModel): Removal | null =>
  model.removals.findLast(undoable) ?? null;

// A reply's view, unless one already shown is newer: answers to a removal and
// to an undo can cross.
const newer = (model: GroupModel, view: GroupView): GroupView =>
  model.view && model.view.group.version > view.group.version ? model.view : view;

export const nothingToAdd = "Nothing that was dropped names an item. Drop a Jira item or a file.";

export function groupReplied(model: GroupModel, msg: Replied): [GroupModel, Effect[]] {
  const { tag } = msg;
  switch (tag.kind) {
    case "groupChanged": {
      if (tag.id !== model.id) return [model, []];
      // The first removal waiting is the one answered, and the next goes now;
      // unless the answer still holds it, as one to a removal sent before
      // the page was opened again does.
      const [done, ...rest] = model.removing;
      const next = rest[0] ? [removal(model.id, rest[0].id)] : [];
      if (!msg.ok) return [{ ...model, removing: rest, notice: errorOf(msg.body) }, next];
      const answer = msg.body as GroupView;
      if (done && answer.members.some((each) => each.ref.id === done.id))
        return [{ ...model, view: newer(model, answer), status: "ready" }, []];
      const view = newer(model, answer);
      const undo = done?.member
        ? { member: done.member, version: (msg.body as GroupView).group.version, countdown: 0 }
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
    case "restored": {
      if (tag.id !== model.id) return [model, []];
      if (!msg.ok) return [{ ...model, notice: errorOf(msg.body) }, []];
      return [{ ...model, view: newer(model, msg.body as GroupView), status: "ready" }, []];
    }
    case "group": {
      if (tag.id !== model.id) return [model, []];
      if (!msg.ok)
        return [
          { ...model, status: model.view ? "ready" : "failed", notice: errorOf(msg.body) },
          [],
        ];
      return [{ ...model, view: newer(model, msg.body as GroupView), status: "ready" }, []];
    }
    case "groupSynced":
      if (tag.id !== model.id || !msg.ok) return [model, []];
      return [{ ...model, view: newer(model, msg.body as GroupView), status: "ready" }, []];
    case "renamed": {
      if (tag.id !== model.id || model.view === null) return [model, []];
      if (!msg.ok) return [{ ...model, notice: errorOf(msg.body) }, []];
      return [{ ...model, view: { ...model.view, group: msg.body as GroupSummary } }, []];
    }
    case "dropped": {
      if (tag.groupId !== model.id) return [model, []];
      if (!msg.ok) return [{ ...model, notice: errorOf(msg.body) }, []];
      const reply = msg.body as DropReply;
      return [{ ...model, view: newer(model, reply.group), notice: dropNotice(reply) }, []];
    }
    case "threadOpened": {
      if (tag.groupId !== model.id) return [model, []];
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

// What a group or thread with no items asks for: there is nothing to ask
// about, so the agent can only create items, as when planning an epic.
export const planPrompt =
  "What are you planning? Describe it, and ask for an epic and its stories…";

// The group page's ask box, worded for how many items the group has.
export function askPrompt(size: number): string {
  if (size === 0) return planPrompt;
  if (size === 1) return "Ask about this item…";
  return `Ask about these ${size} items…`;
}
