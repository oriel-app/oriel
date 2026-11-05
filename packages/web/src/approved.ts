// After an approval in a thread, as Settings' "After you approve" says: the
// page stays, or once Oriel accepts the approval, before its apply ends, it
// goes on to the next thread that needs the user (`nextNeedingYou`), with a
// note in the bead that links back. With nothing else needing them, it
// stays and says so. Only Approve on a thread's own page moves it: no other
// page sends one from the window. While the note shows, the approval's own
// answer says how the apply ended: Applied, or the problem, which stays
// until dismissed. Either way it reaches the thread left as it would have
// anyway, in Needs you.
import { errorOf, type Effect } from "./http.ts";
import { nav, nextNeedingYou } from "./nav.ts";
import type { Model, Msg } from "./root.ts";
import type { Route } from "./route.ts";
import { afterApprove } from "./settings.ts";
import {
  type Held,
  type Hold,
  hold,
  notHeld,
  restart,
  runsOut,
  type UndoNote,
  type Undos,
} from "./undos.ts";

export type ApprovedNote = {
  changeSetId: string;
  // The thread it was approved in.
  left: { id: string; title: string | null };
  // The thread the page went to, or null when nothing else needed the user.
  to: { id: string; title: string | null } | null;
  // Whether the page is there yet, and its heading has taken focus.
  arrived: boolean;
  focused: boolean;
  // Whether its apply has ended, applied, as the approval's answer says.
  // Until then it's applying.
  applied: boolean;
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
  // The apply that failed while its note showed, said until dismissed,
  // wherever the page goes: the change set, by the thread it was approved
  // in, and why.
  failed: { changeSetId: string; title: string | null; why: string } | null;
};

export type ApprovedMsg =
  | { type: "undoHeld"; by: Hold; held: boolean }
  | { type: "expired"; countdown: number }
  | { type: "failedDismissed" };

export const initApproved = (): ApprovedModel => ({
  note: null,
  last: null,
  countdown: 0,
  held: notHeld,
  failed: null,
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
// stopped: its next approval may move the page again, and its problem, if
// it failed, goes.
// Its problem, if it failed, goes as it's tried again.
export function sending(model: ApprovedModel, msg: Msg): ApprovedModel {
  if (msg.type !== "thread" || msg.msg.type !== "changeSetClicked") return model;
  const { changeSetId } = msg.msg;
  if (changeSetId !== model.last && changeSetId !== model.failed?.changeSetId) return model;
  return {
    ...model,
    last: changeSetId === model.last ? null : model.last,
    failed: changeSetId === model.failed?.changeSetId ? null : model.failed,
  };
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
    applied: false,
  };
  const going: Effect[] = to ? [{ type: "navigate", route: { page: "thread", id: to.id } }] : [];
  const [approved, expiry] = restart({ ...next.approved, note, last: changeSetId }, expired);
  return [{ ...next, approved }, [...going, ...expiry]];
}

// The approval's answer, once the apply ends, while its note shows: the
// note says Applied, with its full time again, or gives way to the problem.
// An answer after the note has gone changes nothing here.
export function answered(model: ApprovedModel, msg: Msg): [ApprovedModel, Effect[]] {
  const { note } = model;
  if (note === null || note.applied || msg.type !== "replied") return [model, []];
  const { tag } = msg;
  if (tag.kind !== "changeSet" || tag.changeSetId !== note.changeSetId) return [model, []];
  const why = msg.ok ? stopped(msg.body) : errorOf(msg.body);
  if (why === null) return restart({ ...model, note: { ...note, applied: true } }, expired);
  const failed = { changeSetId: note.changeSetId, title: note.left.title, why };
  return [{ ...model, note: null, failed }, []];
}

// Why an apply that answered stopped short of applied, or null if it didn't.
function stopped(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return "It stopped before all of it applied.";
  const problem = "problem" in body && typeof body.problem === "string" ? body.problem : null;
  const status =
    "changeSet" in body &&
    typeof body.changeSet === "object" &&
    body.changeSet !== null &&
    "status" in body.changeSet
      ? body.changeSet.status
      : null;
  if (status === "applied") return null;
  return problem ?? "It stopped before all of it applied.";
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
    case "failedDismissed":
      return [{ ...model, failed: null }, []];
  }
}

const expired = (countdown: number): Msg => ({
  type: "approved",
  msg: { type: "expired", countdown },
});

const named = (title: string | null) => `“${title ?? "New thread"}”`;

// What the note says: the change set approved, by its thread's name as its
// chip names it, applying and then applied, and a link back; or that
// nothing else needs the user. A screen reader hears where the page went,
// too.
export function approvedText(note: ApprovedNote): {
  said: string;
  heard: string | null;
  mark: NonNullable<UndoNote["mark"]>;
} {
  if (note.to === null) return { said: "All caught up.", heard: null, mark: "caught-up" };
  if (note.applied)
    return { said: `Applied ${named(note.left.title)}.`, heard: null, mark: "applied" };
  return {
    said: `You approved ${named(note.left.title)}. Applying…`,
    heard: `Now on ${named(note.to.title)}, the next thread that needs you.`,
    mark: "applying",
  };
}

// The note, for the bead, keeping its key as it changes from applying to
// applied, or to its problem, so the one shape changes.
export function approvedUndos(model: ApprovedModel, send: (msg: ApprovedMsg) => void): Undos {
  const { note, failed } = model;
  const problem = failed && {
    key: noteKey(failed.changeSetId),
    said: `Couldn't apply ${named(failed.title)}. ${failed.why}`,
    onDismiss: () => send({ type: "failedDismissed" }),
  };
  if (note === null) return { notes: [], problem };
  const { said, heard, mark } = approvedText(note);
  return {
    notes: [
      {
        key: noteKey(note.changeSetId),
        said,
        label: said,
        onUndo: null,
        mark,
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
    problem,
  };
}

const noteKey = (changeSetId: string) => `approved-${changeSetId}`;
