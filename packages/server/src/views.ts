// The view data the JSON routes return, built from the stores. Plain data in
// the shapes @oriel/web/view declares; the window renders it as it is.
import {
  type Block,
  escapeHatchBlock,
  type ChangeSet,
  type ChangeSets,
  type ChangeSetState,
  type Diff,
  type WorkstreamChange,
  type WorkstreamMember,
  type IndexRecord,
  type Instant,
  type ItemId,
  isItemId,
  isUlid,
  type NextStep,
  parseItemId,
  type Presentations,
  type Ulid,
  type Draft,
  type ReviewTable,
  type Thread,
} from "@oriel/core";
import { plainError } from "@oriel/changeset";
import type { WorkstreamStore, Message, ThreadStore, ThreadSummary } from "@oriel/db";
import { itemRow } from "@oriel/groupings";
import { byItemId, parseDeclared } from "@oriel/sources";
import type {
  BlockView,
  ChangeSetStatus,
  ChangeSetView,
  ChatEntry,
  Chips,
  ChipView,
  DiffView,
  WorkstreamChangeView,
  WorkstreamSummary,
  WorkstreamView,
  ItemRef,
  ItemValue,
  MemberView,
  RunView,
  ThreadStateId,
  ThreadSummaryView,
  ThreadView,
} from "@oriel/web/view";
import { chipIds, quoteKey } from "@oriel/web/markdown";
import { waitingOn, waitsOnUser } from "@oriel/web/view";
import { actionLineView } from "./action-lines.ts";
import { agentEvent, type AgentEvent } from "./agent.ts";
import { listedWorkstreams } from "./window-chat.ts";

export type ViewDeps = {
  workstreams: WorkstreamStore;
  threads: ThreadStore;
  // The index's live records, from every source.
  records: () => readonly IndexRecord[];
  presentations: Presentations;
  // The instant item rows count idle days back from.
  asOf: () => Instant;
  now: () => Instant;
  running: (threadId: Ulid) => boolean;
  changeSets: Pick<ChangeSets, "get" | "ofThread" | "nextSteps" | "applying" | "stalled">;
  // What a draft would replace now, and the name of what it sets; null when
  // that's gone (decision 0051).
  drafted: (draft: Draft) => { over: unknown; name: string } | null;
  // A draft as Oriel draws it from its source, when its connector drafts in
  // its own form; null otherwise.
  drawn?: (draft: Draft) => ReviewTable[] | null;
  writable: boolean;
  // Where a sketch's frame comes from: this URL plus `<thread>/<sketch>`.
  sketchBase: URL;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// What fits on one line of a list of threads beside a thread's workstream and time.
const maxTitleChars = 60;

// A thread's title until the model's arrives, or if it never does: the
// first line of what the person asked, or as many of its sentences as fit
// if they fill half the line, or else its words up to the limit, with an
// ellipsis. A closing full stop
// or colon goes; a question mark stays.
export function clippedTitle(text: string): string | null {
  const line = text
    .split("\n")
    .map((l) => l.trim().replace(/\s+/g, " "))
    .find(Boolean);
  if (!line) return null;
  const tidy = (title: string) => title.replace(/[.:;,。]+$/u, "") || null;
  // By what a reader sees as one character, so an emoji is never split.
  const chars = [...graphemes.segment(line)].map((g) => g.segment);
  if (chars.length <= maxTitleChars) return tidy(line);
  const sentences = /^.*(?:[.?!](?=\s)|[。？！])/u.exec(
    chars.slice(0, maxTitleChars + 1).join(""),
  )?.[0];
  if (sentences && [...graphemes.segment(sentences)].length >= maxTitleChars / 2)
    return tidy(sentences);
  const head = chars.slice(0, maxTitleChars - 1).join("");
  const space = head.lastIndexOf(" ");
  const words = (space > 0 ? head.slice(0, space) : head).replace(/[\s.,;:\-–—]+$/u, "");
  return words ? `${words}…` : null;
}

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

// Only an http(s) location becomes a link.
export function webUrl(location: string): string | null {
  const url = URL.parse(location);
  return url && (url.protocol === "https:" || url.protocol === "http:") ? url.href : null;
}

const keyOf = (id: string) => parseItemId(id)?.key ?? id;

export const identity = (item: { id: string; stableId: string }) =>
  `${parseItemId(item.id)?.prefix ?? ""}\u0000${item.stableId}`;

// The member of a workstream a handle names. Through the index, by identity, so
// an item that moved is found under its current handle; failing that, by the
// handle the member was added with, if no live item has that member's
// identity (it was deleted, or its key was reused by another item).
export function memberOf(
  handle: string,
  held: readonly WorkstreamMember[],
  records: readonly IndexRecord[],
): WorkstreamMember | undefined {
  const record = records.find((r) => r.id === handle);
  const live = new Set(records.map(identity));
  return (
    (record && held.find((m) => identity(m) === identity(record))) ??
    held.find((m) => m.id === handle && !live.has(identity(m)))
  );
}

// What a diff field's value reads as: a person by name, an item by its key,
// a link by its title. Blank text is empty.
function display(
  field: string,
  value: unknown,
  person: (id: string) => string | null,
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  if (typeof value === "string" && field === "assignee") return person(value) ?? value;
  // Only a declared kind's: text such as "fix:login" is shown as written.
  if (typeof value === "string") return parseDeclared(value) ? keyOf(value) : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object" && "title" in value && typeof value.title === "string")
    return value.title;
  return JSON.stringify(value) ?? null;
}

// Where a change set stands, from its rows: applied in full or in part; or,
// with nothing applied, approved, stopped (approved, and apply stopped at a
// change, which says why), rejected or open.
export function changeSetStatus(set: ChangeSet): ChangeSetStatus {
  const applied = set.mutations.filter((m) => m.status === "applied").length;
  if (applied > 0 && applied === set.mutations.length) return "applied";
  if (applied > 0) return "partial";
  if (set.decision?.kind === "approved")
    return set.mutations.some((m) => m.error !== null) ? "stopped" : "approved";
  if (set.decision) return set.decision.kind;
  return "open";
}

// Where a change set stands, in a person's words (`ChangeSetState`). One a revert undid, in any
// part, is reverted; one applied in part is applied; one approved but
// stopped before anything landed is still approved.
export function changeSetState(set: ChangeSet, all: readonly ChangeSet[]): ChangeSetState {
  const undone = all.some(
    (other) => other.revertOf === set.id && other.mutations.some((m) => m.status === "applied"),
  );
  if (undone) return "reverted";
  const status = changeSetStatus(set);
  if (status === "applied" || status === "partial") return "applied";
  if (status === "approved" || status === "stopped") return "approved";
  return status === "rejected" ? "rejected" : "pending";
}

// What can be done with it comes from the change set engine (`nextSteps`),
// never from here; while it applies, nothing can. `stalled`: its apply's
// last send has had no answer for a send's lease.
export function changeSetView(
  set: ChangeSet,
  all: readonly ChangeSet[],
  nextSteps: readonly NextStep[],
  applying: boolean,
  writable: boolean,
  stalled: boolean,
): ChangeSetView {
  return {
    id: set.id,
    readOnly: !writable,
    status: applying ? "applying" : changeSetStatus(set),
    nextSteps: nextSteps.map((step) => ({ ...step })),
    applying,
    stalled: applying && stalled,
    // A change sent with no answer may have landed.
    sentUnapplied: set.mutations.some((m) => m.status === "failed"),
    decision: set.decision && {
      kind: set.decision.kind,
      via: set.decision.via,
      by: set.decision.by,
      at: set.decision.at,
    },
    // While it applies, a row's mark is a send in flight, not a stop.
    errors: set.mutations.flatMap((m) =>
      !applying && m.status !== "applied" && m.error !== null
        ? [{ mutationId: m.id, error: plainError(m.error), sent: m.status === "failed" }]
        : [],
    ),
    revertOf: set.revertOf,
    reverts: all.filter((other) => other.revertOf === set.id).map((other) => other.id),
    createdAt: set.createdAt,
  };
}

function runView(result: Extract<AgentEvent, { kind: "run.finished" }>["result"]): RunView {
  const last = result.transcript.findLast((e) => e.kind !== "log");
  return {
    outcome: result.outcome,
    wallMs: result.wallMs,
    reads: result.reads.map((read) => ({
      fn: read.fn,
      status: read.status,
      outsideRegion: read.outsideRegion,
    })),
    mutations: result.mutations.length,
    logs: result.transcript.flatMap((e) => (e.kind === "log" ? [e.text] : [])),
    returned:
      last?.kind === "return" && last.value !== undefined
        ? (JSON.stringify(last.value, null, 2) ?? null)
        : null,
    error:
      last?.kind === "error"
        ? { phase: last.error.phase, message: last.error.message, hint: last.error.hint ?? null }
        : null,
  };
}

export function views(deps: ViewDeps) {
  const { workstreams, threads } = deps;

  // The index by handle and by identity (source and stable ID), which
  // outlives a handle.
  const lookup = () => {
    const records = deps.records();
    const byId = new Map(records.map((r) => [r.id, r]));
    const byIdentity = new Map(records.map((r) => [identity(r), r]));
    // By identity only: a handle another item has taken since names that
    // other item, not this one.
    const find = (member: WorkstreamMember): IndexRecord | undefined =>
      byIdentity.get(identity(member));
    return { byId, find };
  };

  const ref = (record: IndexRecord | undefined, id: string): ItemRef => ({
    id: record?.id ?? id,
    key: keyOf(record?.id ?? id),
    title: record?.title ?? null,
    url: record ? webUrl(record.location) : null,
  });

  const people = () => {
    const names = new Map<string, string>();
    for (const record of deps.records())
      for (const person of record.facets.people ?? []) names.set(person.id, person.name);
    return (id: string) => names.get(id) ?? null;
  };

  const members = (items: readonly WorkstreamMember[]): MemberView[] => {
    const { find } = lookup();
    const asOf = deps.asOf();
    return items
      .map((member) => {
        const record = find(member);
        return {
          ref: ref(record, member.id),
          row: record ? itemRow(record, asOf, deps.presentations) : null,
        };
      })
      .toSorted((a, b) => byItemId(a.ref.id, b.ref.id));
  };

  const counts = (summaries: readonly ThreadSummary[]): Record<ThreadStateId, number> => {
    const out: Record<ThreadStateId, number> = {
      working: 0,
      done: 0,
      "handed-off": 0,
      dropped: 0,
    };
    for (const { thread } of summaries) out[thread.state] += 1;
    return out;
  };

  const doneOf = (id: Ulid): WorkstreamSummary["done"] => {
    const done = threads.workstreamDone(id, deps.now());
    if (!done) return null;
    const by = done.by === "user" || done.by === "agent" || done.by === "tool" ? done.by : "other";
    return { at: done.at, by };
  };

  const workstreamSummary = (id: Ulid): WorkstreamSummary => {
    const workstream = workstreams.get(id);
    if (!workstream) throw new RangeError(`no workstream ${id}`);
    const latest = workstreams.region(id, workstream.version);
    const { origin } = workstream;
    return {
      id: workstream.id,
      name: workstream.name,
      origin:
        origin.kind === "cluster"
          ? { kind: "cluster", grouping: origin.grouping, label: workstream.name || null }
          : { kind: origin.kind },
      version: workstream.version,
      size: latest?.items.length ?? 0,
      createdAt: workstream.createdAt,
      threads: counts(threads.ofWorkstream(id, deps.now())),
      done: doneOf(id),
    };
  };

  const title = (threadId: Ulid): string | null => {
    const titled = threads.title(threadId);
    if (titled !== null) return titled;
    const first = threads.messages(threadId).find((m) => m.role === "user");
    return first?.role === "user" ? clippedTitle(first.text) : null;
  };

  // Where each of a thread's change sets stands, and what the engine says
  // can be done with it.
  const changeSetsOf = async (threadId: Ulid) =>
    Promise.all(
      (await deps.changeSets.ofThread(threadId)).map(async (set) => ({
        status: deps.changeSets.applying(set.id) ? ("applying" as const) : changeSetStatus(set),
        stalled: deps.changeSets.stalled(set.id),
        nextSteps: await deps.changeSets.nextSteps(set.id),
      })),
    );

  // What's held in a working thread for the user: a message, a draft.
  const heldIn = (thread: Thread) => {
    const held = thread.state === "working" ? threads.held(thread.id) : [];
    return {
      held: held.some((each) => "from" in each),
      drafted: held.some((each) => "draft" in each),
    };
  };

  const threadSummary = async ({
    thread,
    activityAt,
  }: ThreadSummary): Promise<ThreadSummaryView> => ({
    id: thread.id,
    title: title(thread.id),
    workstream: { id: thread.workstreamId, name: workstreams.get(thread.workstreamId)?.name ?? "" },
    state: thread.state,
    doneBy: thread.doneBy,
    waitingOn: waitingOn({
      state: thread.state,
      running: deps.running(thread.id),
      ...heldIn(thread),
      changeSets: thread.state === "working" ? await changeSetsOf(thread.id) : [],
      windowChat: threads.isWindowChat(thread.id),
    }),
    activityAt,
  });

  // A workstream's changes after version `from`, up to `to`.
  const between = (workstreamId: Ulid, from: number, to: number): WorkstreamChange[] =>
    workstreams.changes(workstreamId, from).filter((change) => change.version <= to);

  const changeView = (changes: readonly WorkstreamChange[]): WorkstreamChangeView[] => {
    // By identity, so an item that moved since keeps its title.
    const { find } = lookup();
    return changes.map((change) => ({
      version: change.version,
      at: change.at,
      added: change.added.map((m) => ref(find(m), m.id)),
      removed: change.removed.map((m) => ref(find(m), m.id)),
      cause: change.cause.kind,
      ...(change.cause.kind === "agent"
        ? { thread: { id: change.cause.threadId, title: title(change.cause.threadId) } }
        : {}),
    }));
  };

  // The items of a thread's workstream that the agent or an outside tool
  // put there, by the handle each joined under, and who.
  const broughtIn = (threadId: Ulid): Map<string, "agent" | "tool"> => {
    const thread = threads.get(threadId, deps.now());
    const by = new Map<string, "agent" | "tool">();
    for (const change of thread ? workstreams.changes(thread.workstreamId, 0) : []) {
      for (const member of change.removed) by.delete(member.id);
      for (const member of change.added)
        if (change.cause.kind === "agent" || change.cause.kind === "tool")
          by.set(member.id, change.cause.kind);
        else by.delete(member.id);
    }
    return by;
  };

  // A block as the window shows it: rows of items as Browse shows them, from
  // the index now, each from outside the region that the region holds too
  // saying so.
  const blockView = (built: Block, region: ReadonlySet<string>): BlockView => {
    const { spec: _spec, ...block } = built;
    if (block.form === "timeline" || block.form === "pivot") {
      // Labels that are items, as each lane of history()'s items is and
      // each of their epics, by the name the index has for each now
      // (decision 0053): Oriel's data, never the agent's.
      const { byId } = lookup();
      const labels =
        block.form === "timeline"
          ? block.lanes.map((lane) => lane.label)
          : Object.values(block.tables).flatMap((table) => [...table.rows, ...table.columns]);
      const names = Object.fromEntries(
        [...new Set(labels)].flatMap((label) => {
          const record = isItemId(label) ? byId.get(label) : undefined;
          return record ? [[label, record.title]] : [];
        }),
      );
      return { ...block, names };
    }
    if (block.form !== "rows") return block;
    const { byId } = lookup();
    const asOf = deps.asOf();
    const items = block.items.map((id) => {
      const record = byId.get(id);
      return {
        ref: ref(record, id),
        row: record ? itemRow(record, asOf, deps.presentations) : null,
        ...(block.outside && region.has(id) ? { inRegion: true as const } : {}),
      };
    });
    return { ...block, items };
  };

  // A stored chat message as the window shows it; null for an agent event
  // in a shape this server doesn't know.
  const entry = (
    message: Message,
    own: { thread: Ulid; workstream: Ulid },
    region: ReadonlySet<string>,
  ): ChatEntry | null => {
    const workstreamId = own.workstream;
    const at = { seq: message.seq, at: message.at };
    if (message.role === "user") return { ...at, kind: "user", text: message.text };
    if (message.role === "held" && "draft" in message) {
      // Drawn from Oriel's own data: the connection by its name, and each
      // option the draft changes, as it was drafted over and as drafted.
      const { draft, over, outcome } = message;
      const now = deps.drafted(draft);
      const id = draft.input["connection"];
      const options = draft.input["options"];
      const was = isRecord(over) ? over : {};
      const changes = isRecord(options)
        ? Object.entries(options)
            .filter(([option, value]) => JSON.stringify(was[option]) !== JSON.stringify(value))
            .map(([option, value]) => ({ option, was: was[option] ?? null, drafted: value }))
        : [];
      return {
        ...at,
        kind: "draft",
        connection: now && typeof id === "string" ? { id, name: now.name } : null,
        changes,
        tables: outcome === null ? (deps.drawn?.(draft) ?? null) : null,
        stale: now === null || JSON.stringify(now.over) !== JSON.stringify(over),
        outcome,
      };
    }
    if (message.role === "held") {
      const { from, text, outcome } = message;
      // Who it is from, as the user reads it: what each sender says of
      // itself, less Oriel's own bookkeeping.
      const sender = { kind: from.kind, by: from.by, changeSetId: from.changeSet };
      return { ...at, kind: "held", from: sender, text, outcome };
    }
    if (message.role === "note") {
      // The agent alone reads of unknown chips: the answer showed each. A
      // check of the answer's quotes captions them (`ThreadView.quotes`).
      if (message.note.kind === "unknown-chips" || message.note.kind === "quotes") return null;
      const { kind, changeSet, via } = message.note;
      return { ...at, kind: "note", note: { kind, changeSetId: changeSet, via } };
    }
    if (message.role === "marker") {
      const covered = between(workstreamId, message.from, message.to);
      const changes = changeView(covered);
      const causes = covered.map((change) => change.cause);
      const ownAgent = (cause: WorkstreamChange["cause"]) =>
        cause.kind === "agent" && cause.threadId === own.thread;
      const fromLine = (cause: WorkstreamChange["cause"]) =>
        cause.kind === "user" && cause.via === own.thread;
      return {
        ...at,
        kind: "marker",
        from: message.from,
        to: message.to,
        added: changes.flatMap((c) => c.added),
        removed: changes.flatMap((c) => c.removed),
        // This thread's agent made every change it covers, so the list of
        // what it did says it already.
        ...(causes.length > 0 && causes.every(ownAgent) ? { ownAgent: true as const } : {}),
        // It covers the user's Undo or Redo under this thread's agent's
        // reply, and nothing but that and what the agent did, which the
        // lines there say.
        ...(causes.some(fromLine) && causes.every((cause) => fromLine(cause) || ownAgent(cause))
          ? { fromLine: true as const }
          : {}),
      };
    }
    const checked = agentEvent(message.event);
    if (!checked.ok) return null;
    const event = checked.value;
    switch (event.kind) {
      case "text":
        return { ...at, kind: "text", text: event.text };
      case "run.started":
        return { ...at, kind: "run.started", runId: event.runId, script: event.script };
      case "run.finished":
        return { ...at, kind: "run.finished", runId: event.runId, run: runView(event.result) };
      // The escape hatch: what a run reached outside the region, as rows,
      // marked so (decision 0030). An item the region holds too says so.
      // What a run reached outside the region shows unasked, as the escape
      // hatch's block (decision 0030), built as any block is.
      case "search": {
        const block = escapeHatchBlock(event.hits);
        return block ? { ...at, kind: "block", block: blockView(block, region) } : null;
      }
      case "block.refused":
      case "sketch.refused":
        return null;
      case "block":
        return { ...at, kind: "block", block: blockView(event.block, region) };
      // A sketch, framed from the sketch origin, which checks it again.
      case "sketch": {
        const { id, height } = event.sketch;
        const src = new URL(`${own.thread}/${id}`, deps.sketchBase).href;
        return { ...at, kind: "sketch", sketch: { src, height } };
      }
      case "change-set":
        return { ...at, kind: "change-set", changeSetId: event.changeSetId };
      case "actions":
        return {
          ...at,
          kind: "actions",
          lines: event.lines.map((line) => {
            const view = actionLineView(line, own);
            // Nothing links to what is gone since, as a workstream whose
            // making was undone.
            const { touched } = view;
            const gone =
              touched &&
              (touched.kind === "workstream"
                ? !workstreams.get(touched.id as Ulid)
                : !threads.get(touched.id as Ulid, deps.now()));
            return gone ? { ...view, touched: null } : view;
          }),
        };
      case "limit":
        return { ...at, kind: "limit", reason: event.reason };
      case "error":
        return { ...at, kind: "error", message: event.message };
      case "done":
        return { ...at, kind: "done" };
    }
  };

  // What each ID a thread's answers name is, as its chip draws it (decision
  // 0032): an item from the index, by its handle now, or a thread, change
  // set or workstream from Oriel's own data; null for one Oriel can't
  // resolve. An item the thread's workstream has held, gone from the index
  // since, is its key, as the workstream shows it. Nothing comes from the
  // answer's own words.
  const chips = async (ids: readonly string[], threadId: Ulid): Promise<Chips> => {
    const { byId } = lookup();
    const asOf = deps.asOf();
    const now = deps.now();
    const workstreamId = threads.get(threadId, now)?.workstreamId;
    const held = new Set(
      workstreamId
        ? workstreams.changes(workstreamId, 0).flatMap((change) => change.added.map((m) => m.id))
        : [],
    );
    const chip = async (id: string): Promise<ChipView | null> => {
      const parsed = parseItemId(id);
      if (parsed) {
        const record = byId.get(id as ItemId);
        if (!record && held.has(id as ItemId)) {
          const name = "Not in the index";
          return {
            kind: "item",
            source: parsed.kind,
            key: parsed.key,
            name,
            url: null,
            state: null,
          };
        }
        if (!record) return null;
        const row = itemRow(record, asOf, deps.presentations);
        const { key, title: name, status: state } = row;
        const url = webUrl(record.location);
        return { kind: "item", source: parsed.kind, key, name, url, state };
      }
      if (!isUlid(id)) return null;
      const thread = threads.get(id, now);
      if (thread) {
        const summary = await threadSummary({ thread, activityAt: thread.createdAt });
        const state = waitsOnUser(summary.waitingOn) ? "needs-you" : thread.state;
        return { kind: "thread", name: summary.title ?? "New thread", state };
      }
      const workstream = workstreams.get(id);
      if (workstream) {
        const done = threads.workstreamDone(id, now) !== null;
        return { kind: "workstream", name: workstream.name, done };
      }
      const set = await deps.changeSets.get(id);
      if (!set || !threads.get(set.threadId, now)) return null;
      const all = await deps.changeSets.ofThread(set.threadId);
      const name = title(set.threadId) ?? "New thread";
      return { kind: "change-set", thread: set.threadId, name, state: changeSetState(set, all) };
    };
    return Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await chip(id)])));
  };

  const regionIds = (workstreamId: Ulid, version: number): Set<string> =>
    new Set(workstreams.region(workstreamId, version)?.items.map((m) => m.id) ?? []);

  return {
    workstreamSummary,
    members,
    // A block outside any thread, as the overview shows a Noticed card's or
    // a pin's.
    block: (built: Block) => blockView(built, new Set()),

    workstreams(workspaceId: Ulid): WorkstreamSummary[] {
      return workstreams
        .list(workspaceId)
        .filter(listedWorkstreams({ workstreams, threads, now: deps.now }))
        .map((workstream) => workstreamSummary(workstream.id));
    },

    async workstream(id: Ulid): Promise<WorkstreamView | null> {
      const workstream = workstreams.get(id);
      if (!workstream) return null;
      return {
        workstream: workstreamSummary(id),
        members: members(workstreams.region(id, workstream.version)?.items ?? []),
        changes: changeView(between(id, 0, workstream.version)).toReversed(),
        threads: await Promise.all(threads.ofWorkstream(id, deps.now()).map(threadSummary)),
      };
    },

    threads(workspaceId: Ulid): Promise<ThreadSummaryView[]> {
      return Promise.all(threads.list(workspaceId, deps.now()).map(threadSummary));
    },

    title,
    chips,

    entry(message: Message, threadId: Ulid): ChatEntry | null {
      const thread = threads.get(threadId, deps.now());
      if (!thread) return null;
      return entry(
        message,
        { thread: thread.id, workstream: thread.workstreamId },
        regionIds(thread.workstreamId, thread.regionVersion),
      );
    },

    async thread(
      id: Ulid,
      sets: readonly ChangeSet[],
      steps: ReadonlyMap<string, readonly NextStep[]>,
      applying: (changeSetId: string) => boolean,
      stalled: (changeSetId: string) => boolean,
      // Whether a change set can be approved here; by the thread's own
      // `writable` unless given.
      writable: (changeSetId: string) => boolean = () => deps.writable,
    ): Promise<ThreadView | null> {
      const thread = threads.get(id, deps.now());
      if (!thread) return null;
      const workstream = workstreams.get(thread.workstreamId);
      if (!workstream) return null;
      const region = workstreams.region(thread.workstreamId, thread.regionVersion);
      const messages = threads.messages(id);
      // Each entry against the version the thread was in when it was stored:
      // the one its last marker moved it to, or the one it opened in.
      const firstMarker = messages.find((m) => m.role === "marker");
      let version = firstMarker?.role === "marker" ? firstMarker.from : thread.regionVersion;
      const versions = new Map<number, Set<string>>();
      const idsAt = (at: number) => {
        const known = versions.get(at) ?? regionIds(thread.workstreamId, at);
        versions.set(at, known);
        return known;
      };
      const entries = messages.flatMap((m) => {
        if (m.role === "marker") version = m.to;
        return entry(m, { thread: id, workstream: thread.workstreamId }, idsAt(version)) ?? [];
      });
      return {
        id,
        title: title(id),
        workstream: { id: workstream.id, name: workstream.name, version: workstream.version },
        state: thread.state,
        doneBy: thread.doneBy,
        regionVersion: thread.regionVersion,
        members: members(region?.items ?? []),
        entries,
        lastSeq: messages.at(-1)?.seq ?? 0,
        running: deps.running(id),
        changeSets: sets.map((set) =>
          changeSetView(
            set,
            sets,
            steps.get(set.id) ?? [],
            applying(set.id),
            writable(set.id),
            stalled(set.id),
          ),
        ),
        writable: deps.writable,
        chips: await chips(answered(entries), id),
        quotes: Object.fromEntries(
          messages.flatMap((m) =>
            m.role === "note" && m.note.kind === "quotes"
              ? m.note.checked.map((quote) => [quoteKey(quote), quote.found])
              : [],
          ),
        ),
        ...(threads.isWindowChat(id) ? { windowChat: true as const } : {}),
      };
    },

    // While the change set applies, no line says why it stopped: a row's
    // mark is a send in flight.
    diff(diff: Diff, set: ChangeSet, applying: boolean): DiffView {
      const { byId } = lookup();
      const person = people();
      // An item a value names, by the title the diff gives it; a new item
      // has no key or link yet.
      const item = (value: unknown, title: string | null, created: boolean): ItemValue | null => {
        if (typeof value !== "string") return null;
        if (created) return { title, key: null, url: null, created };
        const record = parseItemId(value) ? byId.get(value as ItemId) : undefined;
        return {
          title: title ?? record?.title ?? null,
          key: keyOf(value),
          url: record ? webUrl(record.location) : null,
          created,
        };
      };
      const rows = new Map(set.mutations.map((m) => [m.id, m]));
      const brought = broughtIn(set.threadId);
      const named = (line: Diff["lines"][number]) =>
        [
          ...new Set(
            [line.target, ...line.fields.flatMap((f) => [f.before, f.after])].filter(
              (value): value is string => typeof value === "string" && brought.has(value),
            ),
          ),
        ].map((id) => ({ key: keyOf(id), by: brought.get(id) ?? "agent" }));
      return {
        changeSetId: diff.changeSetId,
        hash: diff.hash,
        lines: diff.lines.map((line) => {
          const row = rows.get(line.mutationId);
          const applied = row?.status === "applied";
          const error = !applied && !applying && row?.error ? plainError(row.error) : null;
          return {
            mutationId: line.mutationId,
            sentence: line.sentence,
            target:
              line.target !== null && parseItemId(line.target)
                ? ref(byId.get(line.target as ItemId), line.target)
                : null,
            kind: line.kind,
            makes: line.makes,
            applied,
            error,
            brought: named(line),
            fields: line.fields.map((field) => ({
              name: field.name,
              before: display(field.name, field.before, person),
              after: field.createdAbove
                ? "created above"
                : display(field.name, field.after, person),
              ...(field.titles && {
                items: {
                  before: item(field.before, field.titles.before, false),
                  after: item(field.after, field.titles.after, field.createdAbove === true),
                },
              }),
            })),
          };
        }),
      };
    },
  };
}

export type Views = ReturnType<typeof views>;

// The IDs a thread's answers name as chips. An answer streams in as many
// text entries, which may split an ID, so each run of them is read whole.
export function answered(entries: readonly ChatEntry[]): string[] {
  const answers: string[] = [];
  let last: ChatEntry | undefined;
  for (const entry of entries) {
    if (entry.kind === "text")
      if (last?.kind === "text") answers[answers.length - 1] += entry.text;
      else answers.push(entry.text);
    last = entry;
  }
  return [...new Set(answers.flatMap(chipIds))];
}
