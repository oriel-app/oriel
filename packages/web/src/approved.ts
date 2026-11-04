// After an approval in a thread, as Settings' "After you approve" says: the
// page stays, or once Oriel accepts the approval, before its apply ends, it
// goes on to the next thread that needs the user (`nextNeedingYou`), with a
// note in the one stack of Undo notes that links back. With nothing else
// needing them, it stays and says so. Only Approve on a thread's own page
// moves it: no other page sends one from the window. How the apply ends
// reaches the thread left as it would have anyway, in Needs you.
import type { Effect } from "./http.ts";
import { nav, nextNeedingYou } from "./nav.ts";
import type { Model, Msg } from "./root.ts";
import type { Route } from "./route.ts";
import { afterApprove } from "./settings.ts";
import { type Held, type Hold, hold, notHeld, restart, runsOut, type Undos } from "./undos.ts";

export type ApprovedNote = {
  changeSetId: string;
  // The thread it was approved in.
  left: { id: string; title: string | null };
  // The thread the page went to, or null when nothing else needed the user.
  to: { id: string; title: string | null } | null;
  // Whether the page is there yet, and its heading has taken focus.
  arrived: boolean;
  focused: boolean;
};

export type ApprovedModel = {
  // The note, while it shows.
  note: ApprovedNote | null;
  // The change set last acted on, so the approval's answer, after its
  // stream said it started applying, doesn't act again.
  last: string | null;
  // The times its countdown started; only the latest one's end hides it.
  countdown: number;
  held: Held;
};

export type ApprovedMsg =
  | { type: "undoHeld"; by: Hold; held: boolean }
  | { type: "expired"; countdown: number };

export const initApproved = (): ApprovedModel => ({
  note: null,
  last: null,
  countdown: 0,
  held: notHeld,
});

// The change set whose approval, sent from the thread's page on screen,
// Oriel has just accepted: its apply started, as the thread's stream says,
// or the approval was answered first. Null for anything else, and for one
// already acted on.
export function accepted(model: Model, msg: Msg): string | null {
  const { thread, route } = model;
  if (thread === null || route.page !== "thread" || route.id !== thread.id) return null;
  const id =
    msg.type === "streamed" && msg.event.type === "change-set" && msg.event.applying
      ? msg.event.changeSetId
      : msg.type === "replied" &&
          msg.ok &&
          msg.tag.kind === "changeSet" &&
          msg.tag.threadId === thread.id
        ? msg.tag.changeSetId
        : null;
  if (id === null || thread.deciding[id]?.kind !== "approved") return null;
  return model.approved.last === id ? null : id;
}

// A change set clicked again, as with Approve the rest once its apply
// stopped: its next approval may move the page again.
export function sending(model: ApprovedModel, msg: Msg): ApprovedModel {
  if (msg.type !== "thread" || msg.msg.type !== "changeSetClicked") return model;
  return msg.msg.changeSetId === model.last ? { ...model, last: null } : model;
}

// Once an approval is accepted on the page `before` shows, with `next` the
// app after it: the page goes on to the next thread that needs the user,
// or stays, saying nothing else does. Staying, as Settings may say, says
// nothing.
export function approvedIn(before: Model, next: Model, changeSetId: string): [Model, Effect[]] {
  const left = before.thread;
  if (left === null || afterApprove(next.settings) === "stay") return [next, []];
  const to = nextNeedingYou(nav(before).waiting, left.id);
  const note: ApprovedNote = {
    changeSetId,
    left: { id: left.id, title: left.view?.title ?? null },
    to: to && { id: to.id, title: to.title },
    arrived: false,
    focused: false,
  };
  const going: Effect[] = to ? [{ type: "navigate", route: { page: "thread", id: to.id } }] : [];
  const [approved, expiry] = restart({ ...next.approved, note, last: changeSetId }, expired);
  return [{ ...next, approved }, [...going, ...expiry]];
}

// Going to `route`: the note goes with the page it was shown on, except on
// the way to the thread it moved to.
export function arriving(model: ApprovedModel, route: Route): ApprovedModel {
  const { note } = model;
  if (note === null) return model;
  if (note.to && !note.arrived && route.page === "thread" && route.id === note.to.id)
    return { ...model, note: { ...note, arrived: true } };
  return { ...model, note: null, held: notHeld };
}

// Once the thread moved to has loaded, its heading takes focus, once, so a
// screen reader starts there.
export function focusing(model: Model): [Model, Effect[]] {
  const { note } = model.approved;
  if (note?.to == null || !note.arrived || note.focused) return [model, []];
  if (model.thread?.id !== note.to.id || model.thread.view === null) return [model, []];
  return [
    { ...model, approved: { ...model.approved, note: { ...note, focused: true } } },
    [{ type: "focusHeading" }],
  ];
}

export function updateApproved(model: ApprovedModel, msg: ApprovedMsg): [ApprovedModel, Effect[]] {
  switch (msg.type) {
    case "undoHeld":
      // Once nothing holds it, the note gets its full time again.
      return hold(model, msg.by, msg.held, (left) =>
        left.note === null ? [left, []] : restart(left, expired),
      );
    case "expired":
      if (!runsOut(model, msg.countdown)) return [model, []];
      return [{ ...model, note: null }, []];
  }
}

const expired = (countdown: number): Msg => ({
  type: "approved",
  msg: { type: "expired", countdown },
});

const named = (title: string | null) => `“${title ?? "New thread"}”`;

// What the note says: the change set approved, by its thread's name as its
// chip names it, and a link back; or that nothing else needs the user. A
// screen reader hears where the page went, too.
export function approvedText(note: ApprovedNote): { said: string; heard: string | null } {
  if (note.to === null) return { said: "All caught up.", heard: null };
  return {
    said: `You approved ${named(note.left.title)}. Applying…`,
    heard: `Now on ${named(note.to.title)}, the next thread that needs you.`,
  };
}

// The note, for the stack.
export function approvedUndos(model: ApprovedModel): Undos {
  const { note } = model;
  if (note === null) return { notes: [], problem: null };
  const { said, heard } = approvedText(note);
  return {
    notes: [
      {
        key: `approved-${note.changeSetId}`,
        said,
        label: said,
        onUndo: null,
        ...(heard && { heard }),
        ...(note.to && {
          link: {
            text: "Back",
            label: `Back to ${named(note.left.title)}`,
            route: { page: "thread", id: note.left.id },
          },
        }),
      },
    ],
    problem: null,
  };
}
