import { errorOf, type Effect } from "./http.ts";
import { nav, nextNeedingYou } from "./nav.ts";
import { expected, goingTo, nextToReview } from "./thread.ts";
import { holding, waitingOn, waitsOnUser } from "./view.ts";
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
  left: { id: string; title: string | null };
  to: { id: string; title: string | null } | null;
  next: string | null;
  caughtUp: boolean;
  arrived: boolean;
  focused: boolean;
  applied: boolean;
};

export type ApprovedModel = {
  note: ApprovedNote | null;
  // The stream and the approval's answer can both say it was accepted: this stops the second
  // acting again.
  last: string | null;
  countdown: number;
  held: Held;
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

export function approvedIn(before: Model, next: Model, changeSetId: string): [Model, Effect[]] {
  const left = before.thread;
  if (left === null || afterApprove(next.settings) === "stay") return [next, []];
  const ahead = expected(left);
  const here = ahead && nextToReview(ahead, changeSetId);
  const to = here === null ? nextNeedingYou(nav(before).waiting, left.id) : null;
  const waits =
    ahead !== null &&
    waitsOnUser(
      waitingOn({ ...ahead, held: holding(ahead.entries), windowChat: ahead.windowChat === true }),
    );
  const note: ApprovedNote = {
    changeSetId,
    left: { id: left.id, title: left.view?.title ?? null },
    to: to && { id: to.id, title: to.title },
    next: here,
    caughtUp: here === null && to === null && !waits,
    arrived: false,
    focused: false,
    applied: false,
  };
  const [thread, scrolling] =
    here !== null && next.thread ? goingTo(next.thread, here) : [next.thread, []];
  const going: Effect[] = to ? [{ type: "navigate", route: { page: "thread", id: to.id } }] : [];
  const [approved, expiry] = restart({ ...next.approved, note, last: changeSetId }, expired);
  return [{ ...next, thread, approved }, [...scrolling, ...going, ...expiry]];
}

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

export function arriving(model: ApprovedModel, route: Route): ApprovedModel {
  const { note } = model;
  if (note === null) return model;
  if (note.to && !note.arrived && route.page === "thread" && route.id === note.to.id)
    return { ...model, note: { ...note, arrived: true } };
  return { ...model, note: null, held: notHeld };
}

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

export function approvedText(note: ApprovedNote): {
  said: string;
  heard: string | null;
  mark: NonNullable<UndoNote["mark"]>;
} {
  if (note.caughtUp) return { said: "All caught up.", heard: null, mark: "caught-up" };
  if (note.applied)
    return { said: `Applied ${named(note.left.title)}.`, heard: null, mark: "applied" };
  return {
    said: `You approved ${named(note.left.title)}. Applying…`,
    heard: note.to
      ? `Now on ${named(note.to.title)}, the next thread that needs you.`
      : note.next !== null
        ? "Now on the next change set to review in this thread."
        : null,
    mark: "applying",
  };
}

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
