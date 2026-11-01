// A thread's page: the chat, its change sets with their diffs, and the
// region in the right rail. Entries arrive over the thread's event stream as
// they're stored; change sets are acted on with explicit requests.
import { type Dropped, type DropReply, dropNotice, isEmpty } from "./drop.ts";
import { nothingToAdd } from "./group.ts";
import { type Effect, errorOf, get, post, type Replied } from "./http.ts";
import type {
  ChangeSetView,
  NextStepView,
  ChatEntry,
  HeldFrom,
  DiffView,
  ItemRef,
  RunView,
  StreamEvent,
  ThreadView,
} from "./view.ts";

export type ThreadModel = {
  id: string;
  view: ThreadView | null;
  status: "loading" | "ready" | "failed";
  draft: string;
  sending: boolean;
  diffs: Readonly<Record<string, DiffView>>;
  // A change set with a request in flight.
  busy: readonly string[];
  // A decision sent from this page and not yet answered, by change set. The
  // page and the sidebar show what it will make of the thread (`expected`).
  deciding: Readonly<Record<string, Decision>>;
  // What's wrong with a change set, typed to go with rejecting it, by change
  // set. Rejecting with none stays one click.
  reasons: Readonly<Record<string, string>>;
  // A held message being edited before it is sent, by its place in the chat.
  editing: Readonly<Record<string, string>>;
  // Held messages with a send or discard in flight, by place.
  settling: readonly number[];
  // What the last request about a change set said, when it failed.
  problems: Readonly<Record<string, string>>;
  // Review links minted here, by change set.
  links: Readonly<Record<string, string>>;
  // What dismissing a change set said to check, by change set.
  notes: Readonly<Record<string, readonly string[]>>;
  notice: string | null;
  // The thread was deleted while its page was open.
  deleted: boolean;
  // The page shows the latest entry, so what arrives keeps it there.
  atLatest: boolean;
};

// A step offered for a whole change set. Removing a line is its own message.
export type SetStep = Exclude<NextStepView["kind"], "remove">;

// A rejection's reason is the thread's next message, which starts a turn.
export type Decision = { kind: "approved" } | { kind: "rejected"; reason: string | null };

export type ThreadMsg =
  | { type: "draftChanged"; text: string }
  | { type: "sendClicked" }
  | { type: "stopClicked" }
  | { type: "doneClicked" }
  | { type: "changeSetClicked"; changeSetId: string; step: SetStep }
  | { type: "reasonChanged"; changeSetId: string; text: string }
  | { type: "lineRemoved"; changeSetId: string; mutationId: string }
  | { type: "linkClicked"; changeSetId: string }
  | { type: "linkCopied"; changeSetId: string }
  // A held message, from anyone but the user: sent to the agent as it is, edited
  // first, or discarded. Each is the person's.
  | { type: "heldSendClicked"; seq: number }
  | { type: "heldEditClicked"; seq: number }
  | { type: "heldEdited"; seq: number; text: string }
  | { type: "heldEditCancelled"; seq: number }
  | { type: "heldDiscardClicked"; seq: number }
  // Dropped on the thread: added to its group, which the thread then follows.
  | { type: "dropped"; dropped: Dropped }
  // The page moved: `below`, how far the chat's end is below the window's
  // bottom edge; `up`, whether the user scrolled up or opened a run's
  // output, either of which moves that end further down.
  | { type: "scrolled"; below: number; up: boolean }
  // The page shows what changed, and what the user did meanwhile.
  | { type: "rendered" };

export function initThread(id: string): [ThreadModel, Effect[]] {
  return [
    {
      id,
      view: null,
      status: "loading",
      draft: "",
      sending: false,
      diffs: {},
      busy: [],
      deciding: {},
      reasons: {},
      editing: {},
      settling: [],
      problems: {},
      links: {},
      notes: {},
      notice: null,
      deleted: false,
      atLatest: true,
    },
    [get(`/api/threads/${id}`, { kind: "thread", id })],
  ];
}

const refresh = (model: ThreadModel): Effect =>
  get(`/api/threads/${model.id}`, { kind: "thread", id: model.id });
const diffOf = (changeSetId: string): Effect =>
  post(`/api/change-sets/${changeSetId}/diff`, {}, { kind: "diff", changeSetId });

const problemOf = (body: unknown): string | null =>
  typeof body === "object" && body !== null && "problem" in body && typeof body.problem === "string"
    ? body.problem
    : null;

// The message held at `seq` that waits on the user.
const heldAt = (entries: readonly ChatEntry[], seq: number) =>
  entries.find(
    (entry): entry is Extract<ChatEntry, { kind: "held" }> =>
      entry.kind === "held" && entry.seq === seq && entry.outcome === null,
  ) ?? null;

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
    case "sendClicked": {
      const text = model.draft.trim();
      if (text === "" || model.sending || model.view?.running) return [model, []];
      return [
        { ...model, sending: true, notice: null },
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
    case "changeSetClicked": {
      const { changeSetId, step } = msg;
      // Only what the change set engine offers is sent.
      if (model.busy.includes(changeSetId) || !offered(model, changeSetId, step))
        return [model, []];
      const hash = model.diffs[changeSetId]?.hash;
      const reason = model.reasons[changeSetId]?.trim() || null;
      const decision: Decision | null =
        step === "approve" || step === "approve-rest"
          ? { kind: "approved" }
          : step === "reject"
            ? { kind: "rejected", reason }
            : null;
      if (decision && hash === undefined) return [model, []];
      const body =
        decision === null
          ? {}
          : decision.kind === "rejected" && reason
            ? { hash, reason }
            : { hash };
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
    case "reasonChanged":
      return [{ ...model, reasons: { ...model.reasons, [msg.changeSetId]: msg.text } }, []];
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
      if (model.settling.includes(seq) || heldAt(model.view?.entries ?? [], seq) === null)
        return [model, []];
      const sending = msg.type === "heldSendClicked";
      const edited = model.editing[seq]?.trim();
      // Sending is a message: not while the agent answers, nor as nothing.
      if (sending && (model.view?.running || edited === "")) return [model, []];
      return [
        { ...model, settling: [...model.settling, seq], notice: null },
        [
          post(
            `/api/threads/${model.id}/held/${seq}/${sending ? "send" : "discard"}`,
            sending && edited !== undefined ? { text: edited } : {},
            { kind: "held", threadId: model.id, seq },
          ),
        ],
      ];
    }
    case "heldEditClicked": {
      const held = heldAt(model.view?.entries ?? [], msg.seq);
      if (held === null || msg.seq in model.editing) return [model, []];
      return [{ ...model, editing: { ...model.editing, [msg.seq]: held.text } }, []];
    }
    case "heldEdited":
      if (!(msg.seq in model.editing)) return [model, []];
      return [{ ...model, editing: { ...model.editing, [msg.seq]: msg.text } }, []];
    case "heldEditCancelled":
      return [{ ...model, editing: without(model.editing, String(msg.seq)) }, []];
    case "dropped": {
      if (model.view === null) return [model, []];
      if (isEmpty(msg.dropped)) return [{ ...model, notice: nothingToAdd }, []];
      const groupId = model.view.group.id;
      return [
        { ...model, notice: null },
        [post(`/api/groups/${groupId}/drop`, msg.dropped, { kind: "dropped", groupId })],
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
    case "rendered":
      return [model, model.view && model.atLatest ? [{ type: "showLatest" }] : []];
  }
}

const nearLatest = 40;

// A thread opens at its latest entry, and while the user is there, the
// thread or a diff changing (an entry, a change set's status, a reload after
// its group changed) keeps them there, as does the composer emptying once a
// message is sent. Once it renders, the page is asked
// again, so a user who scrolled up meanwhile, or is reading a run they
// opened, stays where they are.
export function keptAtLatest(before: ThreadModel | null, after: ThreadModel): Effect[] {
  if (after.view === null || !after.atLatest) return [];
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
      // Entries the stream delivered after this view was built stay.
      const newer = model.view?.entries.filter((e) => e.seq > view.lastSeq) ?? [];
      const merged: ThreadView = {
        ...view,
        entries: [...view.entries, ...newer],
        lastSeq: Math.max(view.lastSeq, model.view?.lastSeq ?? 0),
      };
      const unseen = view.changeSets.filter((set) => !(set.id in model.diffs));
      // An edit of a message another page sent or discarded is dropped.
      const editing = Object.fromEntries(
        Object.entries(model.editing).filter(([seq]) => heldAt(merged.entries, Number(seq))),
      );
      return [
        { ...model, view: merged, status: "ready", editing },
        [
          ...(first
            ? [{ type: "subscribe" as const, threadId: model.id, after: view.lastSeq }]
            : []),
          ...unseen.map((set) => diffOf(set.id)),
        ],
      ];
    }
    case "sent":
      if (tag.threadId !== model.id) return [model, []];
      if (!msg.ok) return [{ ...model, sending: false, notice: errorOf(msg.body) }, []];
      return [{ ...model, sending: false, draft: "" }, []];
    case "dropped": {
      if (tag.groupId !== model.view?.group.id) return [model, []];
      if (!msg.ok) return [{ ...model, notice: errorOf(msg.body) }, []];
      // The thread follows its group with a marker; the refresh shows it.
      const reply = msg.body as DropReply;
      return [
        { ...model, notice: dropNotice(reply) },
        reply.added.length > 0 ? [refresh(model)] : [],
      ];
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
      // A rejection stood: its reason went to the thread, or, when it
      // couldn't be said, waits in the message box.
      const rejected = msg.ok && decision?.kind === "rejected" ? decision : null;
      const reasons = rejected ? without(model.reasons, tag.changeSetId) : model.reasons;
      const draft =
        rejected?.reason && problem !== null && model.draft === "" ? rejected.reason : model.draft;
      // Whatever it changed, the server tells the thread's stream, which
      // reloads it here too. A refusal changed nothing, but what it was
      // refused on may have moved: reload.
      return [
        { ...model, busy, deciding, reasons, problems, notes, draft },
        msg.ok ? [] : [diffOf(tag.changeSetId), refresh(model)],
      ];
    }
    // Sent or discarded, it is settled: the reload shows it so. Refused, as
    // mid-turn, it stays held, with why; or another page settled it first.
    case "held": {
      if (tag.threadId !== model.id) return [model, []];
      const settling = model.settling.filter((seq) => seq !== tag.seq);
      return [
        msg.ok
          ? { ...model, settling, editing: without(model.editing, String(tag.seq)) }
          : { ...model, settling, notice: errorOf(msg.body) },
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
// neither offering anything, and a rejection's reason being answered. Only
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
    running:
      view.running ||
      view.changeSets.some((set) => {
        const decision = ahead(set);
        return decision?.kind === "rejected" && decision.reason !== null;
      }),
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
// diffed again.
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
      view: {
        ...view,
        running: event.running,
        state: event.state,
        regionVersion: event.regionVersion,
        title: event.title ?? view.title,
      },
    };
    // A finished turn may have settled the thread; a new version changes the rail.
    return [next, moved || (!event.running && view.running) ? [refresh(model)] : []];
  }
  // Applying started, here or elsewhere: nothing can be done with it until it
  // ends, which the thread says. Once it has, or anything else changed it,
  // its diff and what it offers have moved: one diff, whose reply reloads
  // the thread.
  if (event.type === "change-set")
    return [model, event.applying ? [refresh(model)] : [diffOf(event.changeSetId)]];
  // The lists' business, not the thread's.
  if (event.type === "threads") return [model, []];
  // Its group changed, its name or members, whether or not the thread moved.
  if (event.type === "group") return [model, [refresh(model)]];
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
  // A new change set or group version: fetch what the view lacks.
  const effects: Effect[] =
    entry.kind === "change-set"
      ? [diffOf(entry.changeSetId), refresh(model)]
      : entry.kind === "marker"
        ? [refresh(model)]
        : [];
  return [next, effects];
}

// A thread from nothing, before its first message: a draft in the browser
// only. Sending it makes the group and the thread, once; leaving first makes
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

// The chat as blocks: a reply streamed in parts is one block, and a run's
// start and finish are one block.
export type Block =
  | { kind: "user"; seq: number; text: string }
  | { kind: "reply"; seq: number; text: string }
  | { kind: "marker"; seq: number; from: number; to: number; added: ItemRef[]; removed: ItemRef[] }
  // `stopped`: its turn ended before it finished, as when the user stopped it.
  | {
      kind: "run";
      seq: number;
      runId: string;
      script: string;
      run: RunView | null;
      stopped: boolean;
    }
  | { kind: "search"; seq: number; hits: (ItemRef & { inRegion: boolean })[] }
  | { kind: "change-set"; seq: number; changeSetId: string }
  | {
      kind: "held";
      seq: number;
      from: HeldFrom;
      text: string;
      outcome: "sent" | "discarded" | null;
    }
  | { kind: "notice"; seq: number; tone: "limit" | "error"; text: string };

export function blocks(entries: readonly ChatEntry[]): Block[] {
  const out: Block[] = [];
  // Text after a turn ended, as Oriel's line after a rejection, is a reply
  // of its own.
  let ended = false;
  for (const entry of entries) {
    const last = out.at(-1);
    switch (entry.kind) {
      case "user":
        out.push({ kind: "user", seq: entry.seq, text: entry.text });
        break;
      case "text":
        if (last?.kind === "reply" && !ended) last.text += entry.text;
        else out.push({ kind: "reply", seq: entry.seq, text: entry.text });
        ended = false;
        break;
      case "marker":
        out.push({ ...entry, kind: "marker" });
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
      case "search":
        out.push({ kind: "search", seq: entry.seq, hits: entry.hits });
        break;
      case "held":
        out.push(entry);
        break;
      case "change-set":
        out.push({ kind: "change-set", seq: entry.seq, changeSetId: entry.changeSetId });
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
        ended = true;
        break;
    }
  }
  return out;
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
