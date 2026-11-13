import {
  aboutOf,
  looked,
  type LookingAt,
  type LookingMsg,
  notLooking,
  lookingReported,
  updateLooking,
} from "./looking.ts";
import { type Dropped, type DropReply, dropNotice, isEmpty } from "./drop.ts";
import { nothingToAdd } from "./workstream.ts";
import { type Effect, errorOf, get, post, reached, type Replied, undoing } from "./http.ts";
import type {
  AboutView,
  BlockView,
  SketchView,
  ActionLineView,
  ChangeSetView,
  NextStepView,
  ChatEntry,
  HeldFrom,
  DiffView,
  ItemRef,
  NoteView,
  RunView,
  SecondLookView,
  StreamEvent,
  ThreadView,
  UndoView,
} from "./view.ts";
import { toReview } from "./view.ts";

export type ThreadModel = {
  id: string;
  view: ThreadView | null;
  status: "loading" | "ready" | "failed";
  draft: string;
  lookingAt: LookingAt;
  sending: boolean;
  syncing: boolean;
  diffs: Readonly<Record<string, DiffView>>;
  busy: readonly string[];
  looking: Readonly<Record<string, { id: string; dismissed: boolean } | null>>;
  dismissed: readonly string[];
  deciding: Readonly<Record<string, Decision>>;
  folds: Readonly<Record<string, boolean>>;
  unsettled: readonly string[];
  landing: Readonly<Record<string, "beat" | "closing">>;
  landed: readonly string[];
  editing: Readonly<Record<string, string>>;
  composing: { seq: number; was: string } | null;
  applied: Readonly<Record<string, UndoView>>;
  settling: readonly number[];
  undoing: readonly string[];
  problems: Readonly<Record<string, string>>;
  links: Readonly<Record<string, string>>;
  notice: string | null;
  deleted: boolean;
  // A load asked for before the latest status is answered with an older running, state and version.
  statuses: number;
  atLatest: boolean;
  seen: number | null;
  at: { changeSet: string; shown: boolean } | null;
};

export type SetStep = Exclude<NextStepView["kind"], "remove">;

export type Decision = { kind: "approved" } | { kind: "rejected" };

export type ThreadMsg =
  | { type: "draftChanged"; text: string }
  | { type: "looking"; msg: LookingMsg }
  | { type: "sendClicked" }
  | { type: "stopClicked" }
  | { type: "tryAgainClicked" }
  | { type: "doneClicked" }
  | { type: "syncClicked" }
  | { type: "changeSetClicked"; changeSetId: string; step: SetStep }
  | { type: "foldToggled"; changeSetId: string }
  | { type: "landed"; changeSetId: string }
  | { type: "lineRemoved"; changeSetId: string; mutationId: string }
  | { type: "toReviewClicked"; changeSetId: string }
  | { type: "secondLookClicked"; changeSetId: string }
  | { type: "suggestionAdded"; changeSetId: string; look: string; places: number[] }
  | { type: "lookDismissed"; changeSetId: string; look: string }
  | { type: "linkClicked"; changeSetId: string }
  | { type: "linkCopied"; changeSetId: string }
  | { type: "heldSendClicked"; seq: number }
  | { type: "heldEditClicked"; seq: number }
  | { type: "heldEditCancelled"; seq: number }
  | { type: "heldDiscardClicked"; seq: number }
  | { type: "heldApplyClicked"; seq: number }
  | { type: "heldOptionEdited"; seq: number; option: string; text: string }
  | { type: "heldUndoClicked"; seq: number }
  | { type: "continueClicked"; seq: number }
  | { type: "lineUndoClicked"; seq: number; index: number }
  | { type: "dropped"; dropped: Dropped }
  | { type: "scrolled"; below: number; up: boolean }
  | { type: "rendered" }
  | { type: "latestClicked" };

export function initThread(id: string, changeSet: string | null = null): [ThreadModel, Effect[]] {
  return [
    {
      id,
      view: null,
      status: "loading",
      draft: "",
      lookingAt: notLooking,
      sending: false,
      syncing: false,
      diffs: {},
      busy: [],
      looking: {},
      dismissed: [],
      deciding: {},
      folds: {},
      unsettled: [],
      landing: {},
      landed: [],
      editing: {},
      composing: null,
      applied: {},
      settling: [],
      undoing: [],
      problems: {},
      links: {},
      notice: null,
      deleted: false,
      statuses: 0,
      atLatest: changeSet === null,
      seen: null,
      at: changeSet === null ? null : { changeSet, shown: false },
    },
    [get(`/api/threads/${id}`, { kind: "thread", id })],
  ];
}

export const refresh = ({ id, statuses }: ThreadModel): Effect =>
  get(`/api/threads/${id}`, { kind: "thread", id, ...(statuses > 0 && { statuses }) });
const diffOf = (changeSetId: string): Effect =>
  post(`/api/change-sets/${changeSetId}/diff`, {}, { kind: "diff", changeSetId });
const storedDiffOf = (changeSetId: string): Effect =>
  get(`/api/change-sets/${changeSetId}/diff`, { kind: "diff", changeSetId, stored: true });

const problemOf = (body: unknown): string | null =>
  typeof body === "object" && body !== null && "problem" in body && typeof body.problem === "string"
    ? body.problem
    : null;

const undoOf = (body: unknown): UndoView | null =>
  typeof body === "object" &&
  body !== null &&
  "undo" in body &&
  typeof body.undo === "object" &&
  body.undo !== null &&
  "action" in body.undo &&
  typeof body.undo.action === "string"
    ? (body.undo as UndoView)
    : null;

const heldAt = (entries: readonly ChatEntry[], seq: number) =>
  entries.find(
    (entry): entry is Extract<ChatEntry, { kind: "held" }> =>
      entry.kind === "held" && entry.seq === seq && entry.outcome === null,
  ) ?? null;

const draftAt = (entries: readonly ChatEntry[], seq: number) =>
  entries.find(
    (entry): entry is Extract<ChatEntry, { kind: "draft" }> =>
      entry.kind === "draft" && entry.seq === seq && entry.outcome === null,
  ) ?? null;

export const optionKey = (seq: number, option: string) => `${seq}:${option}`;

export const optionText = (value: unknown): string =>
  Array.isArray(value) && value.every((each) => typeof each === "string")
    ? value.join("\n")
    : typeof value === "string"
      ? value
      : JSON.stringify(value);
const optionValue = (text: string, like: unknown): unknown => {
  if (Array.isArray(like))
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  if (typeof like === "string") return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const draftEdit = (model: ThreadModel, draft: Extract<ChatEntry, { kind: "draft" }>) => {
  const keys = draft.changes.map((change) => optionKey(draft.seq, change.option));
  if (!keys.some((key) => key in model.editing)) return null;
  return Object.fromEntries(
    draft.changes.map((change) => [
      change.option,
      optionValue(model.editing[optionKey(draft.seq, change.option)] ?? "", change.drafted),
    ]),
  );
};

const notEditing = (editing: Readonly<Record<string, string>>, seq: number) =>
  Object.fromEntries(
    Object.entries(editing).filter(([key]) => key !== `${seq}` && !key.startsWith(`${seq}:`)),
  );

export const lineKey = (seq: number, index: number) => `${seq}:${index}`;

const lineAt = (entries: readonly ChatEntry[], seq: number, index: number) => {
  const list = entries.find((entry) => entry.kind === "actions" && entry.seq === seq);
  return list?.kind === "actions" ? (list.lines[index] ?? null) : null;
};

const routes: Record<SetStep, string> = {
  approve: "approve",
  "approve-rest": "approve",
  reject: "reject",
  retry: "apply",
  revert: "revert",
  dismiss: "dismiss",
};

const stepsOf = (model: ThreadModel, changeSetId: string): readonly NextStepView[] =>
  model.view?.changeSets.find((set) => set.id === changeSetId)?.nextSteps ?? [];

const offered = (model: ThreadModel, changeSetId: string, step: SetStep): boolean =>
  stepsOf(model, changeSetId).some((s) => s.kind === step);

export const removable = (model: ThreadModel, changeSetId: string): readonly string[] =>
  stepsOf(model, changeSetId).flatMap((s) => (s.kind === "remove" ? s.mutationIds : []));

const without = <T>(record: Readonly<Record<string, T>>, key: string) =>
  Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));

export function updateThread(model: ThreadModel, msg: ThreadMsg): [ThreadModel, Effect[]] {
  switch (msg.type) {
    case "draftChanged":
      return [{ ...model, draft: msg.text }, []];
    case "looking":
      return [
        { ...model, lookingAt: updateLooking(model.lookingAt, msg.msg) },
        lookingReported(msg.msg),
      ];
    case "sendClicked": {
      const { composing } = model;
      if (composing && heldAt(model.view?.entries ?? [], composing.seq))
        return updateThread(model, { type: "heldSendClicked", seq: composing.seq });
      const text = model.draft.trim();
      if (text === "" || model.sending || model.view?.running) return [model, []];
      return [
        { ...model, sending: true, notice: null, atLatest: true },
        [
          post(
            `/api/threads/${model.id}/messages`,
            { text, about: aboutOf(model.lookingAt) },
            { kind: "sent", threadId: model.id },
          ),
        ],
      ];
    }
    case "tryAgainClicked":
      if (model.sending || model.view?.running !== false) return [model, []];
      return [
        { ...model, sending: true, notice: null, atLatest: true },
        [post(`/api/threads/${model.id}/retry`, {}, { kind: "retried", threadId: model.id })],
      ];
    case "stopClicked":
      return [
        model,
        [post(`/api/threads/${model.id}/stop`, {}, { kind: "threadAction", threadId: model.id })],
      ];
    case "doneClicked":
      return [
        model,
        [post(`/api/threads/${model.id}/done`, {}, { kind: "threadAction", threadId: model.id })],
      ];
    // Not while a turn runs: it works in the version it started in.
    case "syncClicked":
      if (model.syncing || model.view?.running !== false) return [model, []];
      return [
        { ...model, syncing: true, notice: null },
        [
          post(
            `/api/threads/${model.id}/sync`,
            {},
            {
              kind: "synced",
              threadId: model.id,
              statuses: model.statuses,
            },
          ),
        ],
      ];
    case "changeSetClicked": {
      const { changeSetId, step } = msg;
      // Only what the change set engine offers is sent.
      if (model.busy.includes(changeSetId) || !offered(model, changeSetId, step))
        return [model, []];
      const hash = model.diffs[changeSetId]?.hash;
      const decision: Decision | null =
        step === "approve" || step === "approve-rest"
          ? { kind: "approved" }
          : step === "reject"
            ? { kind: "rejected" }
            : null;
      if (decision && hash === undefined) return [model, []];
      const body = decision === null ? {} : { hash };
      return [
        {
          ...model,
          busy: [...model.busy, changeSetId],
          deciding: decision ? { ...model.deciding, [changeSetId]: decision } : model.deciding,
          problems: without(model.problems, changeSetId),
        },
        [
          post(`/api/change-sets/${changeSetId}/${routes[step]}`, body, {
            kind: "changeSet",
            threadId: model.id,
            changeSetId,
          }),
        ],
      ];
    }
    case "foldToggled": {
      const { changeSetId } = msg;
      const set = expected(model)?.changeSets.find((each) => each.id === changeSetId);
      if (!set) return [model, []];
      return [
        {
          ...model,
          folds: { ...model.folds, [changeSetId]: !folded(model, set) },
          landed: model.landed.filter((id) => id !== changeSetId),
        },
        [],
      ];
    }
    case "landed":
      return landed(model, msg.changeSetId);
    case "toReviewClicked":
      return goingTo(model, msg.changeSetId);
    case "lineRemoved": {
      const { changeSetId, mutationId } = msg;
      if (model.busy.includes(changeSetId) || !removable(model, changeSetId).includes(mutationId))
        return [model, []];
      return [
        {
          ...model,
          busy: [...model.busy, changeSetId],
          problems: without(model.problems, changeSetId),
        },
        [
          post(
            `/api/change-sets/${changeSetId}/edit`,
            { remove: [mutationId] },
            { kind: "changeSet", threadId: model.id, changeSetId },
          ),
        ],
      ];
    }
    case "secondLookClicked": {
      const { changeSetId } = msg;
      if (changeSetId in model.looking) return [model, []];
      const look = model.view?.changeSets.find((set) => set.id === changeSetId)?.secondLook;
      const had = look ? { id: look.id, dismissed: dismissed(model, look) } : null;
      return [
        {
          ...model,
          looking: { ...model.looking, [changeSetId]: had },
          dismissed: model.dismissed.filter((id) => id !== look?.id),
          problems: without(model.problems, changeSetId),
        },
        [
          post(
            `/api/change-sets/${changeSetId}/second-look`,
            {},
            { kind: "secondLook", threadId: model.id, changeSetId },
          ),
        ],
      ];
    }
    case "suggestionAdded": {
      const { changeSetId } = msg;
      if (model.busy.includes(changeSetId)) return [model, []];
      return [
        {
          ...model,
          busy: [...model.busy, changeSetId],
          problems: without(model.problems, changeSetId),
        },
        [
          post(
            `/api/change-sets/${changeSetId}/suggestions`,
            { look: msg.look, places: msg.places },
            {
              kind: "changeSet",
              threadId: model.id,
              changeSetId,
            },
          ),
        ],
      ];
    }
    case "lookDismissed": {
      const { changeSetId, look } = msg;
      if (model.dismissed.includes(look)) return [model, []];
      return [
        {
          ...model,
          dismissed: [...model.dismissed, look],
          problems: without(model.problems, changeSetId),
        },
        [
          post(
            `/api/change-sets/${changeSetId}/second-look/dismiss`,
            { look },
            { kind: "lookDismissed", threadId: model.id, changeSetId, look },
          ),
        ],
      ];
    }
    case "linkClicked":
      return [
        model,
        [
          post(
            `/api/change-sets/${msg.changeSetId}/review-link`,
            {},
            {
              kind: "reviewLink",
              changeSetId: msg.changeSetId,
            },
          ),
        ],
      ];
    case "linkCopied": {
      const link = model.links[msg.changeSetId];
      return [model, link ? [{ type: "copy", text: link }] : []];
    }
    case "heldSendClicked":
    case "heldDiscardClicked": {
      const { seq } = msg;
      const entries = model.view?.entries ?? [];
      const discarding = msg.type === "heldDiscardClicked" && draftAt(entries, seq) !== null;
      if (model.settling.includes(seq) || (heldAt(entries, seq) === null && !discarding))
        return [model, []];
      const sending = msg.type === "heldSendClicked";
      const edited = model.composing?.seq === seq ? model.draft.trim() : undefined;
      if (sending && (model.view?.running || edited === "")) return [model, []];
      return [
        {
          ...model,
          settling: [...model.settling, seq],
          notice: null,
          atLatest: model.atLatest || sending,
        },
        [
          post(
            `/api/threads/${model.id}/held/${seq}/${sending ? "send" : "discard"}`,
            sending && edited !== undefined ? { text: edited } : {},
            { kind: "held", threadId: model.id, seq },
          ),
        ],
      ];
    }
    case "lineUndoClicked": {
      const { seq, index } = msg;
      const undo = lineAt(model.view?.entries ?? [], seq, index)?.undo;
      if (!undo || model.undoing.includes(lineKey(seq, index))) return [model, []];
      return [
        { ...model, undoing: [...model.undoing, lineKey(seq, index)], notice: null },
        [
          undoing(
            undo,
            { kind: "lineUndone", threadId: model.id, seq, index },
            { thread: model.id, seq, index },
          ),
        ],
      ];
    }
    case "heldEditClicked": {
      const entries = model.view?.entries ?? [];
      const draft = draftAt(entries, msg.seq);
      if (draft !== null) {
        if (draftEdit(model, draft) !== null) return [model, []];
        const options = draft.changes.map((change) => [
          optionKey(msg.seq, change.option),
          optionText(change.drafted),
        ]);
        return [{ ...model, editing: { ...model.editing, ...Object.fromEntries(options) } }, []];
      }
      const held = heldAt(entries, msg.seq);
      if (held === null || model.composing?.seq === msg.seq) return [model, []];
      const was = model.composing ? model.composing.was : model.draft;
      return [
        { ...model, draft: held.text, composing: { seq: msg.seq, was } },
        [{ type: "focusComposer" }],
      ];
    }
    case "heldOptionEdited": {
      const key = optionKey(msg.seq, msg.option);
      if (!(key in model.editing)) return [model, []];
      return [{ ...model, editing: { ...model.editing, [key]: msg.text } }, []];
    }
    case "heldApplyClicked": {
      const { seq } = msg;
      const draft = draftAt(model.view?.entries ?? [], seq);
      if (draft === null || draft.stale || model.settling.includes(seq)) return [model, []];
      const options = draftEdit(model, draft);
      return [
        { ...model, settling: [...model.settling, seq], notice: null },
        [
          post(
            `/api/threads/${model.id}/held/${seq}/apply`,
            options === null ? {} : { edit: { options } },
            { kind: "draftApplied", threadId: model.id, seq },
          ),
        ],
      ];
    }
    case "continueClicked": {
      const { seq } = msg;
      const offered = model.view?.entries.some(
        (entry) => entry.kind === "continue" && entry.seq === seq && entry.outcome === null,
      );
      if (!offered || model.settling.includes(seq)) return [model, []];
      return [
        { ...model, settling: [...model.settling, seq], notice: null },
        [
          post(
            `/api/threads/${model.id}/held/${seq}/apply`,
            {},
            {
              kind: "continued",
              threadId: model.id,
              seq,
            },
          ),
        ],
      ];
    }
    case "heldUndoClicked": {
      const { seq } = msg;
      const undo = model.applied[seq];
      if (!undo || model.settling.includes(seq)) return [model, []];
      return [
        { ...model, settling: [...model.settling, seq], notice: null },
        [undoing(undo, { kind: "draftUndone", threadId: model.id, seq })],
      ];
    }
    case "heldEditCancelled":
      if (model.composing?.seq === msg.seq)
        return [{ ...model, draft: model.composing.was, composing: null }, []];
      return [{ ...model, editing: notEditing(model.editing, msg.seq) }, []];
    case "dropped": {
      if (model.view === null) return [model, []];
      if (isEmpty(msg.dropped)) return [{ ...model, notice: nothingToAdd }, []];
      const workstreamId = model.view.workstream.id;
      return [
        { ...model, notice: null },
        [
          post(`/api/workstreams/${workstreamId}/drop`, msg.dropped, {
            kind: "dropped",
            workstreamId,
          }),
        ],
      ];
    }
    case "scrolled": {
      // Moving the chat's end further below leaves the latest entry at once, so a slow scroll up isn't pulled back down.
      const { below, up } = msg;
      const atLatest =
        !(up && below > 1) && (Math.abs(below) <= nearLatest || (below > 0 && model.atLatest));
      return atLatest === model.atLatest ? [model, []] : [{ ...model, atLatest }, []];
    }
    case "latestClicked":
      return [{ ...model, atLatest: true }, [{ type: "showLatest", smooth: true }]];
    case "rendered": {
      if (model.view === null) return [model, []];
      const { at } = model;
      if (at === null || at.shown) return [model, model.atLatest ? [{ type: "showLatest" }] : []];
      if (!model.view.changeSets.some((set) => set.id === at.changeSet))
        return [{ ...model, at: null, atLatest: true }, [{ type: "showLatest" }]];
      return [
        { ...model, at: { ...at, shown: true } },
        [{ type: "showChangeSet", changeSetId: at.changeSet }],
      ];
    }
  }
}

const nearLatest = 40;

// Going to a change set leaves the latest entry, so what arrives meanwhile doesn't pull the page back down.
export function goingTo(model: ThreadModel, changeSetId: string): [ThreadModel, Effect[]] {
  return [{ ...model, atLatest: false }, [{ type: "showChangeSet", changeSetId, smooth: true }]];
}

export function nextToReview(view: ThreadView, from: string): string | null {
  const sets = view.changeSets;
  const at = sets.findIndex((set) => set.id === from);
  const waiting = (set: ChangeSetView) => set.id !== from && toReview(set);
  return (
    sets.slice(at + 1).find(waiting)?.id ??
    sets.slice(0, Math.max(at, 0)).findLast(waiting)?.id ??
    null
  );
}

export function seenUpTo(model: ThreadModel): ThreadModel {
  const last = model.view?.lastSeq;
  if (last === undefined || last === model.seen) return model;
  return model.atLatest || model.seen === null ? { ...model, seen: last } : model;
}

export const unseen = (model: ThreadModel): boolean =>
  !model.atLatest && model.seen !== null && (model.view?.lastSeq ?? 0) > model.seen;

export function keptAtLatest(before: ThreadModel | null, after: ThreadModel): Effect[] {
  const opening = after.at !== null && !after.at.shown;
  if (after.view === null || (!after.atLatest && !opening)) return [];
  const changed =
    after.view !== before?.view ||
    after.diffs !== before?.diffs ||
    after.sending !== before?.sending;
  return changed ? [{ type: "rendered", msg: { type: "thread", msg: { type: "rendered" } } }] : [];
}

export function threadReplied(model: ThreadModel, msg: Replied): [ThreadModel, Effect[]] {
  const { tag } = msg;
  switch (tag.kind) {
    case "thread": {
      if (tag.id !== model.id) return [model, []];
      if (!msg.ok) return [{ ...model, status: model.view ? "ready" : "failed" }, []];
      const view = msg.body as ThreadView;
      const first = model.view === null;
      // Entries the stream delivered after this view was built stay, and so
      // does a status it sent after this was asked for: the reply is older.
      const newer = model.view?.entries.filter((e) => e.seq > view.lastSeq) ?? [];
      const said = (tag.statuses ?? 0) < model.statuses ? model.view : null;
      const merged: ThreadView = {
        ...view,
        ...(said && {
          running: said.running,
          state: said.state,
          regionVersion: said.regionVersion,
          title: said.title,
        }),
        entries: [...view.entries, ...newer],
        lastSeq: Math.max(view.lastSeq, model.view?.lastSeq ?? 0),
      };
      const unseen = view.changeSets.filter((set) => !(set.id in model.diffs));
      const editing = Object.fromEntries(
        Object.entries(model.editing).filter(([seq]) => heldAt(merged.entries, Number(seq))),
      );
      // Settled from another page, the words in the composer stay the
      // user's own; sent from this one, its reply takes them.
      const { composing: was } = model;
      const composing =
        was && (heldAt(merged.entries, was.seq) || model.settling.includes(was.seq)) ? was : null;
      const [next, beats] = watched({
        ...model,
        view: merged,
        status: "ready",
        editing,
        composing,
        looking: stillLooking(model.looking, merged),
        notice: reached(model.notice),
      });
      return [
        next,
        [
          ...(first
            ? [{ type: "subscribe" as const, threadId: model.id, after: view.lastSeq }]
            : []),
          ...unseen.flatMap((set) => [storedDiffOf(set.id), diffOf(set.id)]),
          ...beats,
        ],
      ];
    }
    case "sent":
      if (tag.threadId !== model.id) return [model, []];
      if (!msg.ok) return [{ ...model, sending: false, notice: errorOf(msg.body) }, []];
      return [{ ...model, sending: false, draft: "", lookingAt: looked(model.lookingAt) }, []];
    case "dropped": {
      if (tag.workstreamId !== model.view?.workstream.id) return [model, []];
      if (!msg.ok) return [{ ...model, notice: errorOf(msg.body) }, []];
      const reply = msg.body as DropReply;
      return [
        { ...model, notice: dropNotice(reply) },
        reply.added.length > 0 ? [refresh(model)] : [],
      ];
    }
    case "synced": {
      if (tag.threadId !== model.id) return [model, []];
      const settled = { ...model, syncing: false };
      if (!msg.ok) return [{ ...settled, notice: errorOf(msg.body) }, []];
      const { statuses } = tag;
      return threadReplied(settled, { ...msg, tag: { kind: "thread", id: model.id, statuses } });
    }
    case "retried":
      if (tag.threadId !== model.id) return [model, []];
      return [{ ...model, sending: false, notice: msg.ok ? null : errorOf(msg.body) }, []];
    case "threadAction":
      if (tag.threadId !== model.id) return [model, []];
      if (!msg.ok) return [{ ...model, notice: errorOf(msg.body) }, []];
      return [model, [refresh(model)]];
    case "diff": {
      if (!model.view?.changeSets.some((set) => set.id === tag.changeSetId)) return [model, []];
      const shown = model.diffs[tag.changeSetId];
      if (tag.stored)
        return msg.ok && (shown ? shown.stored : !model.problems[tag.changeSetId])
          ? [{ ...model, diffs: { ...model.diffs, [tag.changeSetId]: msg.body as DiffView } }, []]
          : [model, []];
      // Without its live diff, the next reload asks again.
      if (!msg.ok)
        return [
          {
            ...model,
            diffs: shown?.stored ? without(model.diffs, tag.changeSetId) : model.diffs,
            problems: { ...model.problems, [tag.changeSetId]: errorOf(msg.body) },
          },
          [],
        ];
      // A diff records what the person was shown, which approving waits on: the thread reloads after it.
      return [
        {
          ...model,
          diffs: { ...model.diffs, [tag.changeSetId]: msg.body as DiffView },
          problems: without(model.problems, tag.changeSetId),
        },
        [refresh(model)],
      ];
    }
    case "changeSet": {
      if (tag.threadId !== model.id) return [model, []];
      const busy = model.busy.filter((id) => id !== tag.changeSetId);
      const decision = model.deciding[tag.changeSetId];
      const deciding = without(model.deciding, tag.changeSetId);
      const problem = msg.ok ? problemOf(msg.body) : errorOf(msg.body);
      const problems =
        problem === null
          ? without(model.problems, tag.changeSetId)
          : { ...model.problems, [tag.changeSetId]: problem };
      const set = model.view?.changeSets.find((each) => each.id === tag.changeSetId);
      const rejected =
        msg.ok && decision?.kind === "rejected" && problem === null && !set?.revertOf;
      // A refusal changed nothing, but what it was refused on may have moved: reload.
      return [
        { ...model, busy, deciding, problems },
        msg.ok
          ? rejected
            ? [{ type: "focusComposer" }]
            : []
          : [diffOf(tag.changeSetId), refresh(model)],
      ];
    }
    // It asks for the thread now rather than wait on the stream, whose change reads the diff first.
    case "secondLook": {
      if (tag.threadId !== model.id) return [model, []];
      if (msg.ok) return [model, [refresh(model)]];
      return [
        {
          ...model,
          looking: without(model.looking, tag.changeSetId),
          problems: { ...model.problems, [tag.changeSetId]: errorOf(msg.body) },
        },
        [refresh(model)],
      ];
    }
    case "lookDismissed": {
      if (tag.threadId !== model.id || msg.ok) return [model, []];
      return [
        {
          ...model,
          dismissed: model.dismissed.filter((id) => id !== tag.look),
          problems: { ...model.problems, [tag.changeSetId]: errorOf(msg.body) },
        },
        [refresh(model)],
      ];
    }
    case "held": {
      if (tag.threadId !== model.id) return [model, []];
      const settling = model.settling.filter((seq) => seq !== tag.seq);
      const composed = model.composing?.seq === tag.seq;
      return [
        msg.ok
          ? {
              ...model,
              settling,
              editing: notEditing(model.editing, tag.seq),
              ...(composed && { draft: "", composing: null }),
            }
          : { ...model, settling, notice: errorOf(msg.body) },
        [refresh(model)],
      ];
    }
    case "continued": {
      if (tag.threadId !== model.id) return [model, []];
      const settling = model.settling.filter((seq) => seq !== tag.seq);
      if (!msg.ok) return [{ ...model, settling, notice: errorOf(msg.body) }, [refresh(model)]];
      const { thread } = msg.body as { thread: string };
      return [
        { ...model, settling },
        [{ type: "navigate", route: { page: "thread", id: thread } }],
      ];
    }
    case "draftApplied":
    case "draftUndone": {
      if (tag.threadId !== model.id) return [model, []];
      const settling = model.settling.filter((seq) => seq !== tag.seq);
      if (!msg.ok) return [{ ...model, settling, notice: errorOf(msg.body) }, [refresh(model)]];
      const undo = undoOf(msg.body);
      const applied =
        tag.kind === "draftApplied" && undo
          ? { ...model.applied, [tag.seq]: undo }
          : without(model.applied, String(tag.seq));
      const notice = problemOf(msg.body);
      return [
        { ...model, settling, applied, notice, editing: notEditing(model.editing, tag.seq) },
        [refresh(model)],
      ];
    }
    case "lineUndone": {
      if (tag.threadId !== model.id) return [model, []];
      const key = lineKey(tag.seq, tag.index);
      const undoing = model.undoing.filter((each) => each !== key);
      return [
        msg.ok ? { ...model, undoing } : { ...model, undoing, notice: errorOf(msg.body) },
        [refresh(model)],
      ];
    }
    case "reviewLink": {
      if (!msg.ok)
        return [
          { ...model, problems: { ...model.problems, [tag.changeSetId]: errorOf(msg.body) } },
          [],
        ];
      const { url } = msg.body as { url: string };
      return [{ ...model, links: { ...model.links, [tag.changeSetId]: url } }, []];
    }
    default:
      return [model, []];
  }
}

// Only while the server still shows the change set undecided; once it shows the decision, or answers, its view stands.
export function expected(model: ThreadModel): ThreadView | null {
  const { view } = model;
  if (view === null || Object.keys(model.deciding).length === 0) return view;
  const ahead = (set: ThreadView["changeSets"][number]) => {
    const decision = model.deciding[set.id];
    return decision !== undefined && set.decision === null ? decision : null;
  };
  return {
    ...view,
    changeSets: view.changeSets.map((set) => {
      const decision = ahead(set);
      if (decision === null) return set;
      return decision.kind === "approved"
        ? { ...set, status: "applying", applying: true, nextSteps: [] }
        : { ...set, status: "rejected", nextSteps: [] };
    }),
  };
}

// A reconnected stream doesn't replay what it missed, and an ok reply waits on the stream,
// so the thread reloads once and every change set is diffed again.
export function reconnected(model: ThreadModel): [ThreadModel, Effect[]] {
  if (model.view === null) return [model, []];
  return [model, [refresh(model), ...model.view.changeSets.map((set) => diffOf(set.id))]];
}

export function streamed(model: ThreadModel, event: StreamEvent): [ThreadModel, Effect[]] {
  const { view } = model;
  if (view === null) return [model, []];
  if (event.type === "status") {
    const moved = event.regionVersion !== view.regionVersion;
    const next = {
      ...model,
      statuses: model.statuses + 1,
      view: {
        ...view,
        running: event.running,
        state: event.state,
        regionVersion: event.regionVersion,
        title: event.title ?? view.title,
      },
    };
    return [next, moved || (!event.running && view.running) ? [refresh(next)] : []];
  }
  if (event.type === "change-set")
    return [model, event.applying || event.look ? [refresh(model)] : [diffOf(event.changeSetId)]];
  if (event.type === "threads") return [model, []];
  if (event.type === "workstream") return [model, [refresh(model)]];
  if (event.type === "chat") return [model, [refresh(model)]];
  if (event.type === "deleted") return [{ ...model, deleted: true }, [{ type: "unsubscribe" }]];
  const { entry } = event;
  if (entry.seq <= view.lastSeq) return [model, []];
  const next = {
    ...model,
    view: { ...view, entries: [...view.entries, entry], lastSeq: entry.seq },
  };
  const effects: Effect[] =
    entry.kind === "change-set"
      ? [diffOf(entry.changeSetId), refresh(model)]
      : entry.kind === "marker" || (entry.kind === "note" && entry.note.kind === "continued-in")
        ? [refresh(model)]
        : [];
  return [next, effects];
}

// `id` tells this draft's reply from one sent from an earlier draft.
export type NewThreadModel = {
  id: number;
  draft: string;
  workstream: string | null;
  workstreamName: string;
  lookingAt: LookingAt;
  sending: boolean;
  notice: string | null;
};

export const blankWorkstreamName = "New workstream";

export type NewThreadMsg =
  | { type: "draftChanged"; text: string }
  | { type: "workstreamPicked"; workstream: string | null }
  | { type: "workstreamNamed"; name: string }
  | { type: "looking"; msg: LookingMsg }
  // `workstream` may have gone, or been marked done, since it was picked.
  | { type: "sendClicked"; workstream: string | null };

export const initNewThread = (id: number): NewThreadModel => ({
  id,
  draft: "",
  workstream: null,
  workstreamName: blankWorkstreamName,
  lookingAt: notLooking,
  sending: false,
  notice: null,
});

export function updateNewThread(
  model: NewThreadModel,
  msg: NewThreadMsg,
): [NewThreadModel, Effect[]] {
  switch (msg.type) {
    case "draftChanged":
      return [{ ...model, draft: msg.text }, []];
    case "workstreamPicked":
      if (model.sending) return [model, []];
      return [{ ...model, workstream: msg.workstream, notice: null }, []];
    case "workstreamNamed":
      return [{ ...model, workstreamName: msg.name }, []];
    case "looking":
      return [
        { ...model, lookingAt: updateLooking(model.lookingAt, msg.msg) },
        lookingReported(msg.msg),
      ];
    case "sendClicked": {
      const text = model.draft.trim();
      if (text === "" || model.sending) return [model, []];
      const tag = { kind: "threadStarted", draft: model.id } as const;
      const name = model.workstreamName.trim();
      const named = name === "" || name === blankWorkstreamName ? {} : { workstreamName: name };
      const about = aboutOf(model.lookingAt);
      return [
        { ...model, workstream: msg.workstream, sending: true, notice: null },
        [
          msg.workstream === null
            ? post("/api/threads", { text, ...named, about }, tag)
            : post(
                `/api/workstreams/${encodeURIComponent(msg.workstream)}/threads`,
                { text, about },
                tag,
              ),
        ],
      ];
    }
  }
}

// The thread takes the draft's place, so Back doesn't return to an empty one.
export function newThreadReplied(model: NewThreadModel, msg: Replied): [NewThreadModel, Effect[]] {
  if (!msg.ok) return [{ ...model, sending: false, notice: errorOf(msg.body) }, []];
  const { id } = msg.body as { id: string };
  return [
    { ...model, sending: false },
    [{ type: "navigate", route: { page: "thread", id }, replace: true }],
  ];
}

export type Entry =
  | { kind: "user"; seq: number; text: string; about?: AboutView }
  | { kind: "reply"; seq: number; text: string }
  | {
      kind: "marker";
      seq: number;
      from: number;
      to: number;
      added: ItemRef[];
      removed: ItemRef[];
      ownAgent?: true;
      fromLine?: true;
    }
  | {
      kind: "run";
      seq: number;
      runId: string;
      script: string;
      run: RunView | null;
      stopped: boolean;
    }
  | { kind: "block"; seq: number; block: BlockView }
  | { kind: "sketch"; seq: number; sketch: SketchView }
  | { kind: "change-set"; seq: number; changeSetId: string }
  | { kind: "revised"; seq: number; changeSetId: string }
  | { kind: "actions"; seq: number; lines: ActionLineView[] }
  | {
      kind: "held";
      seq: number;
      from: HeldFrom;
      text: string;
      outcome: "sent" | "discarded" | null;
    }
  | Extract<ChatEntry, { kind: "draft" }>
  | Extract<ChatEntry, { kind: "continue" }>
  | { kind: "notice"; seq: number; tone: "limit" | "error"; text: string; tryAgain?: true }
  | { kind: "note"; seq: number; note: NoteView };

export function entriesOf(entries: readonly ChatEntry[]): Entry[] {
  const out: Entry[] = [];
  for (const entry of entries) {
    const last = out.at(-1);
    switch (entry.kind) {
      case "user":
        out.push({
          kind: "user",
          seq: entry.seq,
          text: entry.text,
          ...(entry.about ? { about: entry.about } : {}),
        });
        break;
      case "text":
        if (last?.kind === "reply") last.text += entry.text;
        else out.push({ kind: "reply", seq: entry.seq, text: entry.text });
        break;
      case "note":
        out.push({ kind: "note", seq: entry.seq, note: entry.note });
        break;
      case "marker":
        if (!entry.fromLine) out.push({ ...entry, kind: "marker" });
        break;
      case "run.started":
        out.push({
          kind: "run",
          seq: entry.seq,
          runId: entry.runId,
          script: entry.script,
          run: null,
          stopped: false,
        });
        break;
      case "run.finished": {
        const started = out.find((b) => b.kind === "run" && b.runId === entry.runId);
        if (started?.kind === "run") started.run = entry.run;
        else
          out.push({
            kind: "run",
            seq: entry.seq,
            runId: entry.runId,
            script: "",
            run: entry.run,
            stopped: false,
          });
        break;
      }
      case "block":
        out.push({ kind: "block", seq: entry.seq, block: entry.block });
        break;
      case "sketch":
        out.push({ kind: "sketch", seq: entry.seq, sketch: entry.sketch });
        break;
      case "held":
      case "draft":
      case "continue":
        out.push(entry);
        break;
      case "change-set": {
        const { changeSetId } = entry;
        const before = out.findIndex(
          (b) => b.kind === "change-set" && b.changeSetId === changeSetId,
        );
        const earlier = out[before];
        if (earlier) out[before] = { kind: "revised", seq: earlier.seq, changeSetId };
        out.push({ kind: "change-set", seq: entry.seq, changeSetId });
        break;
      }
      case "actions":
        for (let end = out.at(-1); end?.kind === "marker" && end.ownAgent; end = out.at(-1))
          out.pop();
        out.push({ kind: "actions", seq: entry.seq, lines: entry.lines });
        break;
      case "limit":
        out.push({ kind: "notice", seq: entry.seq, tone: "limit", text: entry.reason });
        break;
      case "error":
        out.push({
          kind: "notice",
          seq: entry.seq,
          tone: "error",
          text: entry.message,
          ...(entry.tryAgain && { tryAgain: true as const }),
        });
        break;
      case "done":
        for (const block of out)
          if (block.kind === "run" && block.run === null) block.stopped = true;
        break;
    }
  }
  return out;
}

const dismissed = (model: ThreadModel, look: SecondLookView): boolean =>
  look.dismissed || model.dismissed.includes(look.id);

export const shownLook = (model: ThreadModel, set: ChangeSetView): SecondLookView | null =>
  set.secondLook && !dismissed(model, set.secondLook) ? set.secondLook : null;

function stillLooking(looking: ThreadModel["looking"], view: ThreadView): ThreadModel["looking"] {
  return Object.fromEntries(
    Object.entries(looking).filter(([id, had]) => {
      const look = view.changeSets.find((set) => set.id === id)?.secondLook;
      if (look === undefined) return false;
      if (look === null) return true;
      return had !== null && look.id === had.id && (look.dismissed || !had.dismissed);
    }),
  );
}

// A rejected one folds, so a revised one below isn't buried.
export function folded(model: ThreadModel, set: ChangeSetView): boolean {
  const chosen = model.folds[set.id];
  if (!foldable(model, set)) return false;
  if (chosen !== undefined) return chosen;
  const named = model.at?.changeSet;
  if (named === set.id || (named !== undefined && set.reverts.includes(named))) return false;
  return set.status === "rejected" || !model.unsettled.includes(set.id);
}

export const landMs = 1200;
export const closeMs = 180;

function watched(model: ThreadModel): [ThreadModel, Effect[]] {
  const sets = model.view?.changeSets ?? [];
  const waiting = sets.filter((set) => !foldable(model, set)).map((set) => set.id);
  const beats = sets.filter(
    (set) =>
      model.unsettled.includes(set.id) &&
      !(set.id in model.landing) &&
      foldable(model, set) &&
      set.status === "applied" &&
      set.errors.length === 0 &&
      !set.stalled,
  );
  const unsettled = [...new Set([...model.unsettled, ...waiting])];
  const landing = { ...model.landing };
  for (const set of beats) landing[set.id] = "beat";
  return [{ ...model, unsettled, landing }, beats.map((set) => landedAfter(set.id, landMs))];
}

const landedAfter = (changeSetId: string, ms: number): Effect => ({
  type: "after",
  ms,
  msg: { type: "thread", msg: { type: "landed", changeSetId } },
});

function landed(model: ThreadModel, changeSetId: string): [ThreadModel, Effect[]] {
  const step = model.landing[changeSetId];
  const set = expected(model)?.changeSets.find((each) => each.id === changeSetId);
  if (step === undefined) return [model, []];
  const landing = without(model.landing, changeSetId);
  if (!set || !foldable(model, set)) return [{ ...model, landing }, []];
  const unsettled = model.unsettled.filter((id) => id !== changeSetId);
  const shows = !folded({ ...model, unsettled }, set);
  if (changeSetId in model.folds || shows) return [{ ...model, landing, unsettled }, []];
  if (step === "beat")
    return [
      { ...model, landing: { ...landing, [changeSetId]: "closing" } },
      [landedAfter(changeSetId, closeMs)],
    ];
  return [
    { ...model, landing, unsettled, landed: [...model.landed, changeSetId] },
    [{ type: "focusFolded", changeSetId }],
  ];
}

export function unfolding(model: ThreadModel, changeSetId: string): ThreadModel {
  const outer = model.view?.changeSets.filter((set) => set.reverts.includes(changeSetId)) ?? [];
  const folds = { ...model.folds, [changeSetId]: false };
  for (const set of outer) folds[set.id] = false;
  return { ...model, folds };
}

export function foldable(model: ThreadModel, set: ChangeSetView): boolean {
  const sets = expected(model)?.changeSets ?? [];
  const settled = (each: ChangeSetView): boolean =>
    each.status === "rejected" ||
    (each.status === "applied" &&
      each.reverts.every((id) => {
        const revert = sets.find((one) => one.id === id);
        return revert === undefined || settled(revert);
      }));
  return settled(set);
}

export function stepLabel(step: SetStep, set: ChangeSetView): string {
  switch (step) {
    case "approve":
      return "Approve and apply";
    case "approve-rest":
      return "Approve the rest";
    case "reject":
      return "Reject";
    case "retry":
      return set.errors.length ? "Try again" : "Apply";
    case "revert":
      return set.status === "partial" ? "Revert what was applied" : "Revert";
    case "dismiss":
      return "Dismiss";
  }
}
