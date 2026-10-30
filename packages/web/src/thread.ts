// A thread's page: the chat, its change sets with their diffs, and the
// region in the right rail. Entries arrive over the thread's event stream as
// they're stored; change sets are acted on with explicit requests.
import { type Effect, errorOf, get, post, type Replied } from "./http.ts";
import type {
  ChangeSetView,
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
  notice: string | null;
};

export type ChangeSetAction = "approve" | "reject" | "apply" | "revert";

export type ThreadMsg =
  | { type: "draftChanged"; text: string }
  | { type: "sendClicked" }
  | { type: "stopClicked" }
  | { type: "doneClicked" }
  | { type: "changeSetClicked"; changeSetId: string; action: ChangeSetAction }
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
      notice: null,
    },
    [get(`/api/threads/${id}`, { kind: "thread", id })],
  ];
}

const refresh = (model: ThreadModel): Effect =>
  get(`/api/threads/${model.id}`, { kind: "thread", id: model.id });
const diffOf = (changeSetId: string): Effect =>
  post(`/api/change-sets/${changeSetId}/diff`, {}, { kind: "diff", changeSetId });

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
      const { changeSetId, action } = msg;
      if (model.busy.includes(changeSetId)) return [model, []];
      const hash = model.diffs[changeSetId]?.hash;
      const decides = action === "approve" || action === "reject";
      if (decides && hash === undefined) return [model, []];
      return [
        {
          ...model,
          busy: [...model.busy, changeSetId],
          problems: without(model.problems, changeSetId),
        },
        [
          post(`/api/change-sets/${changeSetId}/${action}`, decides ? { hash } : {}, {
            kind: "changeSet",
            threadId: model.id,
            changeSetId,
          }),
        ],
      ];
    }
    case "lineRemoved": {
      const { changeSetId, mutationId } = msg;
      if (model.busy.includes(changeSetId)) return [model, []];
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
      return [{ ...model, diffs: { ...model.diffs, [tag.changeSetId]: msg.body as DiffView } }, []];
    }
    case "changeSet": {
      if (tag.threadId !== model.id) return [model, []];
      const busy = model.busy.filter((id) => id !== tag.changeSetId);
      const problems = msg.ok
        ? model.problems
        : { ...model.problems, [tag.changeSetId]: errorOf(msg.body) };
      // Whatever happened, the diff and the thread's state may have moved.
      return [{ ...model, busy, problems }, [diffOf(tag.changeSetId), refresh(model)]];
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
  | { kind: "run"; seq: number; runId: string; script: string; run: RunView | null }
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
        });
        break;
      case "run.finished": {
        const started = out.find((b) => b.kind === "run" && b.runId === entry.runId);
        if (started?.kind === "run") started.run = entry.run;
        else
          out.push({ kind: "run", seq: entry.seq, runId: entry.runId, script: "", run: entry.run });
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
      case "done":
        break;
    }
  }
  return out;
}

// What a person can do with a change set as it stands.
export function actionsOf(set: ChangeSetView): ChangeSetAction[] {
  switch (set.status) {
    case "open":
      return ["approve", "reject"];
    case "approved":
    case "partial":
      return ["apply"];
    case "applied":
      return set.reverts.length ? [] : ["revert"];
    case "rejected":
      return [];
  }
}
