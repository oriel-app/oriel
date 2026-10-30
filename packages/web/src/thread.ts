// A thread's page: the chat, its change sets with their diffs, and the
// region in the right rail. Entries arrive over the thread's event stream as
// they're stored; change sets are acted on with explicit requests.
import { type Effect, errorOf, get, post, type Replied } from "./http.ts";
import type {
  ChangeSetView,
  NextStepView,
  ChatEntry,
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
  // What the last request about a change set said, when it failed.
  problems: Readonly<Record<string, string>>;
  // Review links minted here, by change set.
  links: Readonly<Record<string, string>>;
  // What dismissing a change set said to check, by change set.
  notes: Readonly<Record<string, readonly string[]>>;
  notice: string | null;
};

// A step offered for a whole change set. Removing a line is its own message.
export type SetStep = Exclude<NextStepView["kind"], "remove">;

export type ThreadMsg =
  | { type: "draftChanged"; text: string }
  | { type: "sendClicked" }
  | { type: "stopClicked" }
  | { type: "doneClicked" }
  | { type: "changeSetClicked"; changeSetId: string; step: SetStep }
  | { type: "lineRemoved"; changeSetId: string; mutationId: string }
  | { type: "linkClicked"; changeSetId: string }
  | { type: "linkCopied"; changeSetId: string };

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
      problems: {},
      links: {},
      notes: {},
      notice: null,
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
      const decides = step === "approve" || step === "approve-rest" || step === "reject";
      if (decides && hash === undefined) return [model, []];
      return [
        {
          ...model,
          busy: [...model.busy, changeSetId],
          problems: without(model.problems, changeSetId),
        },
        [
          post(`/api/change-sets/${changeSetId}/${routes[step]}`, decides ? { hash } : {}, {
            kind: "changeSet",
            threadId: model.id,
            changeSetId,
          }),
        ],
      ];
    }
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
  }
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
      return [
        { ...model, view: merged, status: "ready" },
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
      return [
        { ...model, diffs: { ...model.diffs, [tag.changeSetId]: msg.body as DiffView } },
        [refresh(model)],
      ];
    }
    case "changeSet": {
      if (tag.threadId !== model.id) return [model, []];
      const busy = model.busy.filter((id) => id !== tag.changeSetId);
      // A refusal, or a decision that stood while applying it didn't.
      const problem = msg.ok ? problemOf(msg.body) : errorOf(msg.body);
      const problems =
        problem === null
          ? without(model.problems, tag.changeSetId)
          : { ...model.problems, [tag.changeSetId]: problem };
      // Dismissing says what to check.
      const warnings = msg.ok ? warningsOf(msg.body) : null;
      const notes = warnings ? { ...model.notes, [tag.changeSetId]: warnings } : model.notes;
      // Whatever it changed, the server tells the thread's stream, which
      // reloads it here too. A refusal changed nothing, but what it was
      // refused on may have moved: reload.
      return [
        { ...model, busy, problems, notes },
        msg.ok ? [] : [diffOf(tag.changeSetId), refresh(model)],
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

// The thread's event stream reconnected after dropping: whatever it missed
// (an apply that ended, say) isn't replayed, so the thread reloads once, and
// a change set that was applying is diffed again, for what stopped it.
export function reconnected(model: ThreadModel): [ThreadModel, Effect[]] {
  if (model.view === null) return [model, []];
  const applying = model.view.changeSets.filter((set) => set.applying).map((set) => diffOf(set.id));
  return [model, [refresh(model), ...applying]];
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
  | { kind: "notice"; seq: number; tone: "limit" | "error"; text: string };

export function blocks(entries: readonly ChatEntry[]): Block[] {
  const out: Block[] = [];
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
