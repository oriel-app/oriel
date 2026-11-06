// A thread's page: the chat, its change sets with their diffs, and the
// region in the right rail. Entries arrive over the thread's event stream as
// they're stored; change sets are acted on with explicit requests.
import { type Dropped, type DropReply, dropNotice, isEmpty } from "./drop.ts";
import { nothingToAdd } from "./workstream.ts";
import { type Effect, errorOf, get, post, reached, type Replied, undoing } from "./http.ts";
import type {
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
  sending: boolean;
  // Sync now was asked for and not yet answered.
  syncing: boolean;
  diffs: Readonly<Record<string, DiffView>>;
  // A change set with a request in flight.
  busy: readonly string[];
  // A change set whose second look was asked for and not yet shown, by the
  // look it had then, if any, and whether that one was dismissed: its button
  // says Looking… until the thread shows another look, or that one again
  // (decision 0054, OA-257). Until then Approve and Reject don't wait.
  looking: Readonly<Record<string, { id: string; dismissed: boolean } | null>>;
  // Second looks dismissed from this page, hidden before the server says so.
  dismissed: readonly string[];
  // A decision sent from this page and not yet answered, by change set. The
  // page and the sidebar show what it will make of the thread (`expected`).
  deciding: Readonly<Record<string, Decision>>;
  // Change sets the user showed (false) or folded (true), against what
  // `folded` would make of them.
  folds: Readonly<Record<string, boolean>>;
  // Change sets this page saw waiting on someone. Settled, one stays shown,
  // unless its apply ends here cleanly: then it folds itself (`landing`).
  unsettled: readonly string[];
  // Change sets whose apply this page saw end, applied: shown for a beat so
  // the person sees it land, then closing as the page folds it.
  landing: Readonly<Record<string, "beat" | "closing">>;
  // Change sets that folded themselves here, which the page says once.
  landed: readonly string[];
  // A held message being edited before it is sent, by its place in the chat;
  // a draft's options, by its place and each option's name (`optionKey`).
  editing: Readonly<Record<string, string>>;
  // Drafts applied from this page, by place, with the Undo the apply gave
  // (decision 0051).
  applied: Readonly<Record<string, UndoView>>;
  // Held messages with a send or discard in flight, by place.
  settling: readonly number[];
  // Lines under the agent's reply with an Undo or redo in flight, by their
  // list's place and theirs in it (`lineKey`).
  undoing: readonly string[];
  // What the last request about a change set said, when it failed.
  problems: Readonly<Record<string, string>>;
  // Review links minted here, by change set.
  links: Readonly<Record<string, string>>;
  // What dismissing a change set said to check, by change set.
  notes: Readonly<Record<string, readonly string[]>>;
  notice: string | null;
  // The thread was deleted while its page was open.
  deleted: boolean;
  // How many statuses the thread's stream has sent. A load asked for before
  // the latest one is answered with an older running, state and version.
  statuses: number;
  // The page shows the latest entry, so what arrives keeps it there.
  atLatest: boolean;
  // The change set the thread's address names: the page opens there instead
  // of at the latest entry, once it has rendered, and marks it.
  at: { changeSet: string; shown: boolean } | null;
};

// A step offered for a whole change set. Removing a line is its own message.
export type SetStep = Exclude<NextStepView["kind"], "remove">;

// Reject is one click: what was wrong is the user's next message, which the
// message box waits for once the thread asks.
export type Decision = { kind: "approved" } | { kind: "rejected" };

export type ThreadMsg =
  | { type: "draftChanged"; text: string }
  | { type: "sendClicked" }
  | { type: "stopClicked" }
  | { type: "doneClicked" }
  // Sync now: the thread catches up with its workstream without a message.
  | { type: "syncClicked" }
  | { type: "changeSetClicked"; changeSetId: string; step: SetStep }
  // A rejected or applied change set shown in full, or folded again.
  | { type: "foldToggled"; changeSetId: string }
  // A change set applied while the page watched: its beat is over, or its
  // closing is, when it folds.
  | { type: "landed"; changeSetId: string }
  | { type: "lineRemoved"; changeSetId: string; mutationId: string }
  // The pill for a change set to review out of view, clicked: the page
  // goes to the nearest one.
  | { type: "toReviewClicked"; changeSetId: string }
  // A change set's second look (decision 0054): asked for, first or again
  // once stale or failed; or a change it suggested, added to the change set.
  // While one shows, the change set offers only what pertains to it: its
  // suggestions, one or all, and Dismiss (OA-257).
  | { type: "secondLookClicked"; changeSetId: string }
  | { type: "suggestionAdded"; changeSetId: string; look: string; places: number[] }
  | { type: "lookDismissed"; changeSetId: string; look: string }
  | { type: "linkClicked"; changeSetId: string }
  | { type: "linkCopied"; changeSetId: string }
  // A held message, from anyone but the user: sent to the agent as it is, edited
  // first, or discarded. Each is the person's.
  | { type: "heldSendClicked"; seq: number }
  | { type: "heldEditClicked"; seq: number }
  | { type: "heldEdited"; seq: number; text: string }
  | { type: "heldEditCancelled"; seq: number }
  | { type: "heldDiscardClicked"; seq: number }
  // A draft of the agent's (decision 0051): applied as it is, its options
  // edited first, or discarded, as a held message is; once applied here, its
  // Undo.
  | { type: "heldApplyClicked"; seq: number }
  | { type: "heldOptionEdited"; seq: number; option: string; text: string }
  | { type: "heldUndoClicked"; seq: number }
  // What the agent did in Oriel, undone from the list under its reply, or
  // done again: the line at `index` in the list at `seq`.
  | { type: "lineUndoClicked"; seq: number; index: number }
  // Dropped on the thread: added to its workstream, which the thread then follows.
  | { type: "dropped"; dropped: Dropped }
  // The page moved: `below`, how far the chat's end is below the window's
  // bottom edge; `up`, whether the user scrolled up or opened a run's
  // output, either of which moves that end further down.
  | { type: "scrolled"; below: number; up: boolean }
  // The page shows what changed, and what the user did meanwhile.
  | { type: "rendered" };

export function initThread(id: string, changeSet: string | null = null): [ThreadModel, Effect[]] {
  return [
    {
      id,
      view: null,
      status: "loading",
      draft: "",
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
      applied: {},
      settling: [],
      undoing: [],
      problems: {},
      links: {},
      notes: {},
      notice: null,
      deleted: false,
      statuses: 0,
      atLatest: changeSet === null,
      at: changeSet === null ? null : { changeSet, shown: false },
    },
    [get(`/api/threads/${id}`, { kind: "thread", id })],
  ];
}

// The thread loaded again, noting what its stream has said so far.
export const refresh = ({ id, statuses }: ThreadModel): Effect =>
  get(`/api/threads/${id}`, { kind: "thread", id, ...(statuses > 0 && { statuses }) });
const diffOf = (changeSetId: string): Effect =>
  post(`/api/change-sets/${changeSetId}/diff`, {}, { kind: "diff", changeSetId });

const problemOf = (body: unknown): string | null =>
  typeof body === "object" && body !== null && "problem" in body && typeof body.problem === "string"
    ? body.problem
    : null;

// The Undo an apply gave, from its reply.
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

// The message held at `seq` that waits on the user.
const heldAt = (entries: readonly ChatEntry[], seq: number) =>
  entries.find(
    (entry): entry is Extract<ChatEntry, { kind: "held" }> =>
      entry.kind === "held" && entry.seq === seq && entry.outcome === null,
  ) ?? null;

// The draft held at `seq` that waits on the user.
const draftAt = (entries: readonly ChatEntry[], seq: number) =>
  entries.find(
    (entry): entry is Extract<ChatEntry, { kind: "draft" }> =>
      entry.kind === "draft" && entry.seq === seq && entry.outcome === null,
  ) ?? null;

// A draft's option as it is edited, by the draft's place and its name.
export const optionKey = (seq: number, option: string) => `${seq}:${option}`;

// A drafted value as the user edits it: a list one entry a line, text as
// it is, anything else as JSON; and back, shaped as the drafted value is.
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

// What a draft's edit at `seq` gives, if it is being edited.
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

// What's being edited at `seq`, a message or a draft's options, gone.
const notEditing = (editing: Readonly<Record<string, string>>, seq: number) =>
  Object.fromEntries(
    Object.entries(editing).filter(([key]) => key !== `${seq}` && !key.startsWith(`${seq}:`)),
  );

export const lineKey = (seq: number, index: number) => `${seq}:${index}`;

// The line at `index` in the list under the agent's reply at `seq`.
const lineAt = (entries: readonly ChatEntry[], seq: number, index: number) => {
  const list = entries.find((entry) => entry.kind === "actions" && entry.seq === seq);
  return list?.kind === "actions" ? (list.lines[index] ?? null) : null;
};

// Each step's route; approving the rest is approving the set as it stands.
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

// The lines the engine says can be left out now.
export const removable = (model: ThreadModel, changeSetId: string): readonly string[] =>
  stepsOf(model, changeSetId).flatMap((s) => (s.kind === "remove" ? s.mutationIds : []));

const warningsOf = (body: unknown): string[] | null =>
  typeof body === "object" &&
  body !== null &&
  "warnings" in body &&
  Array.isArray(body.warnings) &&
  body.warnings.every((w) => typeof w === "string")
    ? body.warnings
    : null;

const without = <T>(record: Readonly<Record<string, T>>, key: string) =>
  Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));

export function updateThread(model: ThreadModel, msg: ThreadMsg): [ThreadModel, Effect[]] {
  switch (msg.type) {
    case "draftChanged":
      return [{ ...model, draft: msg.text }, []];
    // Sending takes the page to the latest entry, where what was said and the
    // reply to it show, and keeps it there.
    case "sendClicked": {
      const text = model.draft.trim();
      if (text === "" || model.sending || model.view?.running) return [model, []];
      return [
        { ...model, sending: true, notice: null, atLatest: true },
        [post(`/api/threads/${model.id}/messages`, { text }, { kind: "sent", threadId: model.id })],
      ];
    }
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
    // Hidden at once; refused, it shows again, with why.
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
      const edited = model.editing[seq]?.trim();
      // Sending is a message: not while the agent answers, nor as nothing.
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
      if (held === null || msg.seq in model.editing) return [model, []];
      return [{ ...model, editing: { ...model.editing, [msg.seq]: held.text } }, []];
    }
    case "heldOptionEdited": {
      const key = optionKey(msg.seq, msg.option);
      if (!(key in model.editing)) return [model, []];
      return [{ ...model, editing: { ...model.editing, [key]: msg.text } }, []];
    }
    // Applied as the user's own call of its action, edited or not; what its
    // action refuses, it stays held, with why.
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
    case "heldUndoClicked": {
      const { seq } = msg;
      const undo = model.applied[seq];
      if (!undo || model.settling.includes(seq)) return [model, []];
      return [
        { ...model, settling: [...model.settling, seq], notice: null },
        [undoing(undo, { kind: "draftUndone", threadId: model.id, seq })],
      ];
    }
    case "heldEdited":
      if (!(msg.seq in model.editing)) return [model, []];
      return [{ ...model, editing: { ...model.editing, [msg.seq]: msg.text } }, []];
    case "heldEditCancelled":
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
      // Moving the chat's end further below leaves the latest entry at once,
      // so a slow scroll up isn't pulled back down. Otherwise, as when coming
      // back from either side, the page is there within a few dozen pixels,
      // and stays there while what arrived renders below.
      const { below, up } = msg;
      const atLatest =
        !(up && below > 1) && (Math.abs(below) <= nearLatest || (below > 0 && model.atLatest));
      return atLatest === model.atLatest ? [model, []] : [{ ...model, atLatest }, []];
    }
    case "rendered": {
      if (model.view === null) return [model, []];
      const { at } = model;
      if (at === null || at.shown) return [model, model.atLatest ? [{ type: "showLatest" }] : []];
      // A change set the thread doesn't have, as in a stale link: its latest.
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

// A thread opens at its latest entry, or at the change set its address
// names, and while the user is at the latest, the thread or a diff changing
// (an entry, a change set's status, a reload after its workstream changed)
// keeps them there, as does the composer emptying once a message is sent.
// Sending one, or a held message, takes them there from anywhere.
// Once it renders, the page is asked again, so a user who scrolled up
// meanwhile, or is reading a run they opened, stays where they are.
// The page glides to one of the thread's change sets, as to the next to
// review, and so leaves its latest entry: what arrives meanwhile doesn't
// pull it back down.
export function goingTo(model: ThreadModel, changeSetId: string): [ThreadModel, Effect[]] {
  return [{ ...model, atLatest: false }, [{ type: "showChangeSet", changeSetId, smooth: true }]];
}

// The change set awaiting review nearest after `from` in the thread, or
// else nearest before it, leaving out `from`; null when there's none.
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

export function keptAtLatest(before: ThreadModel | null, after: ThreadModel): Effect[] {
  const opening = after.at !== null && !after.at.shown;
  if (after.view === null || (!after.atLatest && !opening)) return [];
  const changed =
    after.view !== before?.view ||
    after.diffs !== before?.diffs ||
    after.sending !== before?.sending;
  return changed ? [{ type: "rendered", msg: { type: "thread", msg: { type: "rendered" } } }] : [];
}

// Server replies that belong to this thread's page.
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
      // An edit of a message another page sent or discarded is dropped.
      const editing = Object.fromEntries(
        Object.entries(model.editing).filter(([seq]) => heldAt(merged.entries, Number(seq))),
      );
      const [next, beats] = watched({
        ...model,
        view: merged,
        status: "ready",
        editing,
        looking: stillLooking(model.looking, merged),
        notice: reached(model.notice),
      });
      return [
        next,
        [
          ...(first
            ? [{ type: "subscribe" as const, threadId: model.id, after: view.lastSeq }]
            : []),
          ...unseen.map((set) => diffOf(set.id)),
          ...beats,
        ],
      ];
    }
    case "sent":
      if (tag.threadId !== model.id) return [model, []];
      if (!msg.ok) return [{ ...model, sending: false, notice: errorOf(msg.body) }, []];
      return [{ ...model, sending: false, draft: "" }, []];
    case "dropped": {
      if (tag.workstreamId !== model.view?.workstream.id) return [model, []];
      if (!msg.ok) return [{ ...model, notice: errorOf(msg.body) }, []];
      // The thread follows its workstream with a marker; the refresh shows it.
      const reply = msg.body as DropReply;
      return [
        { ...model, notice: dropNotice(reply) },
        reply.added.length > 0 ? [refresh(model)] : [],
      ];
    }
    // The reply is the thread at its new version.
    case "synced": {
      if (tag.threadId !== model.id) return [model, []];
      const settled = { ...model, syncing: false };
      if (!msg.ok) return [{ ...settled, notice: errorOf(msg.body) }, []];
      const { statuses } = tag;
      return threadReplied(settled, { ...msg, tag: { kind: "thread", id: model.id, statuses } });
    }
    case "threadAction":
      if (tag.threadId !== model.id) return [model, []];
      if (!msg.ok) return [{ ...model, notice: errorOf(msg.body) }, []];
      return [model, [refresh(model)]];
    case "diff": {
      if (!model.view?.changeSets.some((set) => set.id === tag.changeSetId)) return [model, []];
      if (!msg.ok)
        return [
          { ...model, problems: { ...model.problems, [tag.changeSetId]: errorOf(msg.body) } },
          [],
        ];
      // A diff records what the person was shown, which approving waits on:
      // the thread reloads after it, so its steps say what can be done now.
      // It also clears an earlier diff's failure.
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
      // Answered: from here the thread shows what the server says.
      const decision = model.deciding[tag.changeSetId];
      const deciding = without(model.deciding, tag.changeSetId);
      // A refusal, or a decision that stood while applying it didn't.
      const problem = msg.ok ? problemOf(msg.body) : errorOf(msg.body);
      const problems =
        problem === null
          ? without(model.problems, tag.changeSetId)
          : { ...model.problems, [tag.changeSetId]: problem };
      // Dismissing says what to check.
      const warnings = msg.ok ? warningsOf(msg.body) : null;
      const notes = warnings ? { ...model.notes, [tag.changeSetId]: warnings } : model.notes;
      // A rejection stood and the thread asks what was wrong: the message
      // box waits for the answer. It asks nothing of an Undo, which Oriel
      // made, and couldn't if the server says why.
      const set = model.view?.changeSets.find((each) => each.id === tag.changeSetId);
      const rejected =
        msg.ok && decision?.kind === "rejected" && problem === null && !set?.revertOf;
      // Whatever it changed, the server tells the thread's stream, which
      // reloads it here too. A refusal changed nothing, but what it was
      // refused on may have moved: reload.
      return [
        { ...model, busy, deciding, problems, notes },
        msg.ok
          ? rejected
            ? [{ type: "focusComposer" }]
            : []
          : [diffOf(tag.changeSetId), refresh(model)],
      ];
    }
    // The look is running, or shows again: the button says Looking… until
    // the thread shows it, which it asks for now rather than wait on the
    // stream, whose change reads the diff first. Refused, it says why.
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
    // Dismissed, the stream says so; refused, the look shows again, with why.
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
    // Sent or discarded, it is settled: the reload shows it so. Refused, as
    // mid-turn, it stays held, with why; or another page settled it first.
    case "held": {
      if (tag.threadId !== model.id) return [model, []];
      const settling = model.settling.filter((seq) => seq !== tag.seq);
      return [
        msg.ok
          ? { ...model, settling, editing: notEditing(model.editing, tag.seq) }
          : { ...model, settling, notice: errorOf(msg.body) },
        [refresh(model)],
      ];
    }
    // Applied, the draft keeps its Undo here; refused, as when its
    // connection couldn't be read that way, it stays held, with why.
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
      // Kept, a connection whose options don't fit, or whose sync failed,
      // says why.
      const notice = problemOf(msg.body);
      return [
        { ...model, settling, applied, notice, editing: notEditing(model.editing, tag.seq) },
        [refresh(model)],
      ];
    }
    // Its line says what came of it, once the thread reloads; a refusal, as
    // when another page undid it first, says why.
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

// The thread as the decisions sent from its page will leave it, so a click
// shows at once: an approved change set applying, a rejected one rejected,
// neither offering anything. Only
// while the server still shows a change set undecided; once it shows the
// decision, or answers, the server's view stands, and a failed apply offers
// its steps again.
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

// The thread's event stream reconnected after dropping: whatever it missed
// (an apply that ended, an edit this tab made) isn't replayed, and an ok reply
// waits on the stream, so the thread reloads once and every change set is
// diffed again. Once those answer, a request that couldn't reach Oriel
// meanwhile says so no more.
export function reconnected(model: ThreadModel): [ThreadModel, Effect[]] {
  if (model.view === null) return [model, []];
  return [model, [refresh(model), ...model.view.changeSets.map((set) => diffOf(set.id))]];
}

// What the thread's event stream says.
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
    // A finished turn may have settled the thread; a new version changes the rail.
    return [next, moved || (!event.running && view.running) ? [refresh(next)] : []];
  }
  // Applying started, here or elsewhere: nothing can be done with it until it
  // ends, which the thread says. Once it has, or anything else changed it,
  // its diff and what it offers have moved: one diff, whose reply reloads
  // the thread.
  // Only its second look changed: the diff stands, so only the thread loads.
  if (event.type === "change-set")
    return [model, event.applying || event.look ? [refresh(model)] : [diffOf(event.changeSetId)]];
  // The lists' business, not the thread's.
  if (event.type === "threads") return [model, []];
  // Its workstream changed, its name or members, whether or not the thread moved.
  if (event.type === "workstream") return [model, [refresh(model)]];
  // An entry it shows changed, as a held message settles.
  if (event.type === "chat") return [model, [refresh(model)]];
  // Its stream ends with this.
  if (event.type === "deleted") return [{ ...model, deleted: true }, [{ type: "unsubscribe" }]];
  const { entry } = event;
  if (entry.seq <= view.lastSeq) return [model, []];
  const next = {
    ...model,
    view: { ...view, entries: [...view.entries, entry], lastSeq: entry.seq },
  };
  // A new change set or workstream version: fetch what the view lacks.
  const effects: Effect[] =
    entry.kind === "change-set"
      ? [diffOf(entry.changeSetId), refresh(model)]
      : entry.kind === "marker"
        ? [refresh(model)]
        : [];
  return [next, effects];
}

// A thread from nothing, before its first message: a draft in the browser
// only. Sending it makes the workstream and the thread, once; leaving first makes
// nothing. `id` tells this draft's reply from one sent from an earlier draft.
export type NewThreadModel = {
  id: number;
  draft: string;
  sending: boolean;
  notice: string | null;
};

export type NewThreadMsg = { type: "draftChanged"; text: string } | { type: "sendClicked" };

export const initNewThread = (id: number): NewThreadModel => ({
  id,
  draft: "",
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
    case "sendClicked": {
      const text = model.draft.trim();
      if (text === "" || model.sending) return [model, []];
      return [
        { ...model, sending: true, notice: null },
        [post("/api/threads", { text }, { kind: "threadStarted", draft: model.id })],
      ];
    }
  }
}

// The thread started: it takes the draft's place, so Back doesn't return to
// an empty one. It failed: the draft stays, with why.
export function newThreadReplied(model: NewThreadModel, msg: Replied): [NewThreadModel, Effect[]] {
  if (!msg.ok) return [{ ...model, sending: false, notice: errorOf(msg.body) }, []];
  const { id } = msg.body as { id: string };
  return [
    { ...model, sending: false },
    [{ type: "navigate", route: { page: "thread", id }, replace: true }],
  ];
}

// The chat as entries: a reply streamed in parts is one entry, and a run's
// start and finish are one entry. ("Block" is the glossary's word for what
// Oriel builds from a read, which is one kind of entry here; decision 0030.)
export type Entry =
  | { kind: "user"; seq: number; text: string }
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
  // `stopped`: its turn ended before it finished, as when the user stopped it.
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
  | { kind: "actions"; seq: number; lines: ActionLineView[] }
  | {
      kind: "held";
      seq: number;
      from: HeldFrom;
      text: string;
      outcome: "sent" | "discarded" | null;
    }
  | Extract<ChatEntry, { kind: "draft" }>
  | { kind: "notice"; seq: number; tone: "limit" | "error"; text: string }
  | { kind: "note"; seq: number; note: NoteView };

export function entriesOf(entries: readonly ChatEntry[]): Entry[] {
  const out: Entry[] = [];
  for (const entry of entries) {
    const last = out.at(-1);
    switch (entry.kind) {
      case "user":
        out.push({ kind: "user", seq: entry.seq, text: entry.text });
        break;
      case "text":
        if (last?.kind === "reply") last.text += entry.text;
        else out.push({ kind: "reply", seq: entry.seq, text: entry.text });
        break;
      case "note":
        out.push({ kind: "note", seq: entry.seq, note: entry.note });
        break;
      // An Undo or Redo under the agent's reply is said by its line there.
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
        out.push(entry);
        break;
      case "change-set":
        out.push({ kind: "change-set", seq: entry.seq, changeSetId: entry.changeSetId });
        break;
      // The markers its own changes left just before say what its lines
      // say, so they fold in; the rail says the version they moved it to,
      // as it does for every marker.
      case "actions":
        for (let end = out.at(-1); end?.kind === "marker" && end.ownAgent; end = out.at(-1))
          out.pop();
        out.push({ kind: "actions", seq: entry.seq, lines: entry.lines });
        break;
      case "limit":
        out.push({ kind: "notice", seq: entry.seq, tone: "limit", text: entry.reason });
        break;
      case "error":
        out.push({ kind: "notice", seq: entry.seq, tone: "error", text: entry.message });
        break;
      // A turn has ended: a run it started and never finished was stopped.
      case "done":
        for (const block of out)
          if (block.kind === "run" && block.run === null) block.stopped = true;
        break;
    }
  }
  return out;
}

// Whether the person dismissed a second look, here or anywhere (OA-257).
const dismissed = (model: ThreadModel, look: SecondLookView): boolean =>
  look.dismissed || model.dismissed.includes(look.id);

// The second look a change set shows, if any: one nobody dismissed. While
// it shows, the change set offers only what pertains to it (OA-257).
export const shownLook = (model: ThreadModel, set: ChangeSetView): SecondLookView | null =>
  set.secondLook && !dismissed(model, set.secondLook) ? set.secondLook : null;

// The second looks still asked for once the thread shows `view`: each until
// the thread shows a look other than the one it had, or shows that one again
// once dismissed; or until it can have none, decided.
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

// Whether a change set shows as one line, until the user shows it. A rejected
// one does, so a revised one below isn't buried (OA-90); so does one applied,
// with any Undo of it applied or rejected too, its Revert a click away: at
// once if it was so when the page saw it, else once its apply ends here
// cleanly and the beat after it is over (`landing`). Not while the thread's
// address names it or its Undo.
export function folded(model: ThreadModel, set: ChangeSetView): boolean {
  const chosen = model.folds[set.id];
  if (!foldable(model, set)) return false;
  if (chosen !== undefined) return chosen;
  const named = model.at?.changeSet;
  if (named === set.id || (named !== undefined && set.reverts.includes(named))) return false;
  return set.status === "rejected" || !model.unsettled.includes(set.id);
}

// How long a change set whose apply ended here shows before it folds, so the
// person sees it land; and how long it takes to close.
export const landMs = 1200;
export const closeMs = 180;

// The thread as loaded: what waits on someone is noted, and a change set
// noted so that has since settled, applied in full, starts its beat. One
// that stopped short, stalled or applied with errors stays shown.
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

// A change set's beat is over: it closes, then folds, and focus left inside
// it, or dropped as its Approve went, goes to its Show. One that waits on
// someone again meanwhile, as an Undo of it does, stays; one shown or hidden
// by hand since keeps that, and neither closes nor takes focus.
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

// A link to a change set on the page shown opens it, and the one it sits in.
export function unfolding(model: ThreadModel, changeSetId: string): ThreadModel {
  const outer = model.view?.changeSets.filter((set) => set.reverts.includes(changeSetId)) ?? [];
  const folds = { ...model.folds, [changeSetId]: false };
  for (const set of outer) folds[set.id] = false;
  return { ...model, folds };
}

// Whether a change set can fold at all: nothing on it, or on an Undo of it,
// waits on anyone.
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

// What a step is called. The steps themselves come from the change set
// engine; this only names them.
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
