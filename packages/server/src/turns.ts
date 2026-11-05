// Runs threads' turns: one at a time per thread. Each event a turn emits is
// stored in the thread's chat as it arrives and passed to whoever watches
// the thread, so a turn outlives the page that started it, and a page that
// reconnects picks up from the last entry it saw. Stopping is explicit.
import {
  type Held,
  type WorkstreamStore,
  type Message,
  type Move,
  type ThreadStore,
} from "@oriel/db";
import {
  type ActionLine,
  type Draft,
  type Actor,
  type HeldSender,
  type Instant,
  type Log,
  maxUnknownChips,
  type OrielNote,
  type Reader,
  type TelemetryEvent,
  type Thread,
  type Ulid,
} from "@oriel/core";
import { actionRules, capturedRules, type Titler } from "@oriel/agent";
import { chipIds } from "@oriel/web/markdown";
import type { Chips } from "@oriel/web/view";
import { nameOf } from "./names.ts";
import { checkQuotes } from "./quotes.ts";
import {
  type Agent,
  agentEvent,
  type AgentEvent,
  type AgentLimits,
  type ChatMessage,
} from "./agent.ts";

export type ThreadEvent =
  | { type: "message"; message: Message }
  | { type: "status"; running: boolean }
  | { type: "change-set"; changeSetId: Ulid; applying: boolean; look?: true }
  | { type: "workstream" }
  // An entry already in the thread's chat changed, as a held message settles.
  | { type: "chat" }
  | { type: "deleted" };

export class ThreadBusy extends Error {
  constructor() {
    super("The agent is still answering; stop it or wait for it to finish.");
    this.name = "ThreadBusy";
  }
}

// A thread that has reached a per-thread cap; no turn runs.
export class ThreadLimit extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ThreadLimit";
  }
}

// A change set that was rejected, as rejecting it needs it.
type Rejected = { id: Ulid; threadId: Ulid; revertOf: Ulid | null };

export type Caps = Pick<AgentLimits, "maxTurnsPerThread" | "maxTokensPerThread">;

// Whether the thread's last turn ended on a per-thread cap: the agent
// emitted a `limit` after the last thing the user said.
function endedOnLimit(messages: readonly Message[]): boolean {
  const lastAsked = messages.findLastIndex((m) => m.role === "user");
  return messages.slice(lastAsked + 1).some((m) => {
    if (m.role !== "agent") return false;
    const event = agentEvent(m.event);
    return event.ok && event.value.kind === "limit";
  });
}

// A held message the user was to send or discard is gone: they already did
// one or the other, or there never was one.
export class NothingHeld extends Error {
  constructor() {
    super("That message was already sent or discarded.");
    this.name = "NothingHeld";
  }
}

// Characters that show as nothing but that a model reads (Unicode's default
// ignorables: variation selectors, tag characters, bidi controls, fillers
// and the like). A held message loses them, so what the user reads is all
// they send. Only where emoji and joining scripts need them do variation
// selectors 15 and 16 and the joiners stay. A subdivision flag, made with
// tag characters, is held as a plain black flag.
const joining = String.raw`[\p{Script=Arabic}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}]`;
const hidden = new RegExp(
  [
    String.raw`(?<!\p{Extended_Pictographic}\p{Emoji_Modifier}?)[\u{FE0E}\u{FE0F}]`,
    String.raw`(?<![\p{Extended_Pictographic}\p{Emoji_Modifier}\u{FE0F}])\u{200D}`,
    String.raw`\u{200D}(?!\p{Extended_Pictographic})`,
    String.raw`(?<!${joining})\u{200C}`,
    String.raw`\u{200C}(?![\p{L}\p{M}])`,
    String.raw`[\p{Default_Ignorable_Code_Point}--[\u{200C}\u{200D}\u{FE0E}\u{FE0F}]]`,
  ].join("|"),
  "gv",
);

// Why a thread can take no more questions, in plain words, or null: it has
// asked as many as a thread may; or its last turn ended on a cap, which the
// agent decides; or, as a backstop whatever agent is plugged in, it has
// spent all its tokens.
export function capReached(
  messages: readonly Message[],
  caps: Caps,
  // Tokens spent on the thread outside its chat, as its second looks spend.
  also: { inputTokens: number; outputTokens: number } = { inputTokens: 0, outputTokens: 0 },
): string | null {
  const next = "Start a new thread on this workstream to keep going.";
  const asked = messages.filter((m) => m.role === "user").length;
  if (asked >= caps.maxTurnsPerThread)
    return `This thread has had all ${caps.maxTurnsPerThread} of its questions. ${next}`;
  const used = spent(messages);
  const total = used.inputTokens + used.outputTokens + also.inputTokens + also.outputTokens;
  if (endedOnLimit(messages) || total >= caps.maxTokensPerThread)
    return `This thread has used its ${caps.maxTokensPerThread.toLocaleString("en-US")} tokens. ${next}`;
  return null;
}

export type TurnDeps = {
  threads: ThreadStore;
  workstreams: WorkstreamStore;
  agent: Agent;
  // Writes a thread's title from its first message; with none, the window
  // shows that message, clipped.
  titler: Titler | null;
  caps: Caps;
  emit: (event: TelemetryEvent) => void;
  // The index snapshot a turn reads.
  snapshot: () => number;
  // What each ID an answer names as a chip is; null for one Oriel can't
  // resolve (decision 0032).
  chips: (ids: readonly string[], threadId: Ulid) => Promise<Chips>;
  // Items in the index as the agent's `items.read()` reads them, to check
  // what an answer quotes from them (decision 0032); any other reads as gone.
  read: Reader["read"];
  now: () => Instant;
  newId: () => Ulid;
  log: Log;
  // Tokens spent on a thread outside its chat: its second looks' (decision
  // 0054), which the per-thread cap counts too (SPEC §9).
  alsoSpent?: (threadId: Ulid) => { inputTokens: number; outputTokens: number };
};

const maxSummaryChars = 2_000;

// A run as history keeps it: how it ended and what it returned or why it
// failed, cut short, and for a run that captured changes, what they are.
function runSummary(event: Extract<AgentEvent, { kind: "run.finished" }>): string {
  const { result } = event;
  const last = result.transcript.at(-1);
  const detail =
    last?.kind === "return"
      ? `returned ${JSON.stringify(last.value) ?? "undefined"}`
      : last?.kind === "error"
        ? `failed: ${last.error.message}`
        : "returned nothing";
  const short = `${result.outcome}; ${detail}`;
  const cut = short.length > maxSummaryChars ? `${short.slice(0, maxSummaryChars - 1)}…` : short;
  if (!result.mutations.length) return cut;
  return `${cut}; captured ${result.mutations.length} changes (${capturedRules.join(" ")})`;
}

// What the agent reads of the host's list under a reply: each call as it
// applied or was refused, by ID, never by name.
const actionsText = (lines: readonly ActionLine[]): string =>
  [
    ...lines.map((line) => {
      const call = JSON.stringify(line.call);
      if (!line.applied) return `refused ${call}: ${line.why}`;
      return `applied ${call}${line.since?.undone ? ", which the user then undid" : ""}`;
    }),
    ...(lines.some((line) => line.applied) ? [actionRules] : []),
  ].join("\n");

const plus = (
  a: { inputTokens: number; outputTokens: number },
  b: { inputTokens: number; outputTokens: number } = { inputTokens: 0, outputTokens: 0 },
) => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
});

// Tokens the turns in `messages` spent, from their `done` events.
export function spent(messages: readonly Message[]): { inputTokens: number; outputTokens: number } {
  const total = { inputTokens: 0, outputTokens: 0 };
  for (const message of messages) {
    if (message.role !== "agent") continue;
    const event = agentEvent(message.event);
    if (!event.ok || event.value.kind !== "done") continue;
    total.inputTokens += event.value.usage.inputTokens;
    total.outputTokens += event.value.usage.outputTokens;
  }
  return total;
}

// The chat as the agent's history: the user's messages, its own replies
// joined up, each run's script and summary, with the change set its changes
// became, markers naming items by ID only, and Oriel's notes, as Oriel's
// (OA-91). A reason held from a review link is never in it: only what the
// person sends on reaches the agent, as their own message (decision 0024).
export function history(
  messages: readonly Message[],
  markerText: (from: number, to: number) => string,
): ChatMessage[] {
  const out: ChatMessage[] = [];
  const scripts = new Map<string, string>();
  // The turn's last run that captured changes, which its change set holds,
  // as the proposal takes it: a later run that only read or failed doesn't.
  let capturing: Extract<ChatMessage, { role: "run" }> | null = null;
  for (const message of messages) {
    if (message.role === "user") {
      out.push({ role: "user", text: message.text, at: message.at });
      continue;
    }
    if (message.role === "marker") {
      out.push({ role: "marker", text: markerText(message.from, message.to), at: message.at });
      continue;
    }
    if (message.role === "note") {
      // Oriel's check of an answer's quotes is the window's, to caption them.
      if (message.note.kind !== "quotes")
        out.push({ role: "note", note: message.note, at: message.at });
      continue;
    }
    if (message.role === "held") continue;
    const event = agentEvent(message.event);
    if (!event.ok) continue;
    const last = out.at(-1);
    if (event.value.kind === "text") {
      if (last?.role === "assistant") last.text += event.value.text;
      else out.push({ role: "assistant", text: event.value.text, at: message.at });
    }
    // The turn's changes became a change set: the run that captured them
    // says which, so a note about it later is plain (OA-86).
    if (event.value.kind === "change-set" && capturing)
      capturing.summary += `; they are change set ${event.value.changeSetId}`;
    if (event.value.kind === "done") capturing = null;
    if (event.value.kind === "actions")
      out.push({ role: "actions", text: actionsText(event.value.lines), at: message.at });
    if (event.value.kind === "run.started") scripts.set(event.value.runId, event.value.script);
    if (event.value.kind === "run.finished") {
      const script = scripts.get(event.value.runId);
      const run = {
        role: "run" as const,
        runId: event.value.runId,
        summary: runSummary(event.value),
        ...(script === undefined ? {} : { script }),
        at: message.at,
      };
      out.push(run);
      const { result } = event.value;
      if (result.outcome === "ok" && result.mutations.length > 0) capturing = run;
    }
  }
  return out;
}

export type Turns = ReturnType<typeof turns>;

export function turns(deps: TurnDeps) {
  const { threads, workstreams } = deps;
  // Each running turn, and who started it.
  const running = new Map<Ulid, { controller: AbortController; done: Promise<void>; by: Actor }>();
  const watchers = new Map<Ulid, Set<(event: ThreadEvent) => void>>();
  // Pages watching the whole workspace: every list, and a workstream's page.
  const anyWatchers = new Set<(threadId: Ulid | null) => void>();
  // Titles being written, which outlive a stopped turn; closing stops them.
  const titling = new Set<Promise<void>>();
  const closing = new AbortController();

  // Tells the pages watching a thread; `broadcast`, every page watching the
  // workspace; `publish`, both, unless it's an entry in the thread's chat.
  const tell = (threadId: Ulid, event: ThreadEvent) => {
    for (const watcher of watchers.get(threadId) ?? []) watcher(event);
  };
  const broadcast = (threadId: Ulid | null) => {
    for (const watcher of anyWatchers) watcher(threadId);
  };
  const publish = (threadId: Ulid, event: ThreadEvent) => {
    tell(threadId, event);
    if (event.type !== "message") broadcast(threadId);
  };
  // Passes on the chat entry just stored at `seq`.
  const published = (threadId: Ulid, seq: number) => {
    const message = threads.messages(threadId, seq - 1).find((m) => m.seq === seq);
    if (message) publish(threadId, { type: "message", message });
  };

  // What a marker tells the agent: the items added and removed, by ID.
  const markerText = (workstreamId: Ulid) => (from: number, to: number) => {
    const changes = workstreams
      .changes(workstreamId, from)
      .filter((change) => change.version <= to);
    const added = changes.flatMap((change) => change.added.map((m) => m.id));
    const removed = changes.flatMap((change) => change.removed.map((m) => m.id));
    return [
      added.length ? `added ${added.join(", ")}` : "",
      removed.length ? `removed ${removed.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("; ");
  };

  // Each event goes in the chat, but a refused block or sketch, which the
  // run's result already told the agent, and which the user never sees: it
  // is only counted.
  const record = (threadId: Ulid, event: AgentEvent) => {
    if (event.kind !== "block.refused" && event.kind !== "sketch.refused") {
      const seq = threads.append(threadId, { role: "agent", event }, deps.newId(), deps.now());
      published(threadId, seq);
    }
    const counted = ["search", "block", "block.refused", "sketch", "sketch.refused"];
    if (!counted.includes(event.kind)) return;
    const thread = threads.get(threadId, deps.now());
    if (!thread) return;
    const at = deps.now();
    const { workspaceId } = thread;
    if (event.kind === "search")
      deps.emit({ name: "escape-hatch.used", at, workspaceId, threadId, runId: event.runId });
    else if (event.kind === "block")
      deps.emit({ name: "block.shown", at, workspaceId, threadId, form: event.block.form });
    else if (event.kind === "block.refused")
      deps.emit({ name: "block.refused", at, workspaceId, threadId });
    else if (event.kind === "sketch") {
      const { height, html } = event.sketch;
      const bytes = Buffer.byteLength(html, "utf8");
      deps.emit({ name: "sketch.shown", at, workspaceId, threadId, height, bytes });
    } else if (event.kind === "sketch.refused")
      deps.emit({ name: "sketch.refused", at, workspaceId, threadId, reason: event.reason });
  };

  // Titles the thread from its first message, beside its first turn. The
  // title lands whenever it arrives, and every page watching hears; if it
  // never does, the thread keeps the clipped message as its title.
  const title = (threadId: Ulid, text: string) => {
    const { titler } = deps;
    if (!titler) return;
    const log: Log = (message, fields) => deps.log(message, { ...fields, thread_id: threadId });
    const { signal } = closing;
    const done = titler(text, { signal, log })
      .then((written) => {
        if (signal.aborted) return;
        if (written === null) {
          log("title: unusable answer", {});
          return;
        }
        // One deleted meanwhile takes none.
        if (!threads.get(threadId, deps.now())) return;
        threads.setTitle(threadId, written, deps.now());
        // A window chat's workstream takes its title, so kept chats read as
        // what they were about, until the user names it (the store keeps
        // their name).
        const thread = threads.get(threadId, deps.now());
        const workstream = thread && workstreams.get(thread.workstreamId);
        if (workstream?.origin.kind === "window")
          workstreams.rename(workstream.id, nameOf(written), "oriel");
        publish(threadId, { type: "status", running: running.has(threadId) });
      })
      .catch((error: unknown) => {
        if (!signal.aborted)
          log("title: failed", { error: error instanceof Error ? error.message : String(error) });
      });
    titling.add(done);
    void done.finally(() => titling.delete(done));
  };

  // The agent ends each turn with one `done`, stopped or not, so the turn
  // runs to its end. One that throws instead gets an error and a `done`
  // here, so every turn in the chat ends the same way. A stopped turn says so
  // last.
  const run = async (thread: Thread, text: string, seq: number, signal: AbortSignal) => {
    const log: Log = (message, fields) => deps.log(message, { ...fields, thread_id: thread.id });
    let done = false;
    try {
      const region = workstreams.region(thread.workstreamId, thread.regionVersion);
      if (!region) throw new Error(`no version ${thread.regionVersion} of the thread's workstream`);
      const before = threads.messages(thread.id).filter((message) => message.seq < seq);
      const input = {
        thread,
        region,
        history: history(before, markerText(thread.workstreamId)),
        text,
        snapshot: deps.snapshot(),
        spent: plus(spent(before), deps.alsoSpent?.(thread.id)),
      };
      for await (const event of deps.agent.turn(input, { signal, log })) {
        record(thread.id, event);
        if (event.kind === "done") done = true;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("turn: failed", { error: message });
      if (!signal.aborted)
        record(thread.id, {
          kind: "error",
          message: `The agent stopped with an error: ${message}`,
        });
      if (!done) record(thread.id, { kind: "done", usage: { inputTokens: 0, outputTokens: 0 } });
    }
    if (signal.aborted) record(thread.id, { kind: "error", message: "Stopped." });
    const answers = history(
      threads.messages(thread.id).filter((message) => message.seq > seq),
      () => "",
    ).flatMap((message) => (message.role === "assistant" ? [message.text] : []));
    const failed = (what: string) => (error: unknown) =>
      log(`turn: ${what} unchecked`, {
        error: error instanceof Error ? error.message : String(error),
      });
    await unknownChips(thread, answers).catch(failed("chips"));
    await quotes(thread, answers).catch(failed("quotes"));
  };

  // The chips the turn's answer named that Oriel can't resolve, which the
  // window draws as "unknown reference": counted, and noted for the agent's
  // next turn, as Oriel's (decision 0032). Nothing corrects them this turn.
  const unknownChips = async (thread: Thread, answers: readonly string[]) => {
    const said = answers.flatMap(chipIds);
    if (said.length === 0) return;
    const resolved = await deps.chips([...new Set(said)], thread.id);
    const unknown = Object.keys(resolved).filter((id) => resolved[id] === null);
    if (unknown.length === 0 || !threads.get(thread.id, deps.now())) return;
    const at = deps.now();
    deps.emit({
      name: "chip.unknown",
      at,
      workspaceId: thread.workspaceId,
      threadId: thread.id,
      count: unknown.length,
    });
    note(thread.id, { kind: "unknown-chips", ids: unknown.slice(0, maxUnknownChips) });
  };

  // Whether each quote from an item in the turn's answer is in that item
  // word for word, noted for the window to caption it (decision 0032),
  // before the turn is over, so the page that reloads then has it.
  const quotes = async (thread: Thread, answers: readonly string[]) => {
    const checked = await checkQuotes(answers, deps.read);
    if (checked.length === 0 || !threads.get(thread.id, deps.now())) return;
    note(thread.id, { kind: "quotes", checked });
  };

  // The user's message, and a turn to answer it, which runs on after this
  // returns. A settled thread catches up with its workstream first. Counting it
  // is the caller's. `by` started it: only a turn the user started applies
  // the agent's actions (decision 0024).
  const start = (
    threadId: Ulid,
    text: string,
    by: Actor,
  ): { seq: number; at: Instant; workspaceId: Ulid } => {
    if (running.has(threadId)) throw new ThreadBusy();
    // The per-thread caps hold whatever agent is plugged in (SPEC §9).
    const earlier = threads.messages(threadId);
    const reason = capReached(earlier, deps.caps, deps.alsoSpent?.(threadId));
    if (reason !== null) {
      const last = earlier.at(-1);
      const said = last?.role === "agent" && agentEvent(last.event);
      if (!(said && said.ok && said.value.kind === "limit" && said.value.reason === reason))
        record(threadId, { kind: "limit", reason });
      throw new ThreadLimit(reason);
    }
    const first = !earlier.some((m) => m.role === "user");
    const now = deps.now();
    const ids = { marker: deps.newId(), message: deps.newId() };
    // A tool that speaks for the user says so under its words (OA-75).
    const said = threads.say(threadId, text, ids, now, by.kind === "tool" ? by.name : undefined);
    if (said.move) published(threadId, said.move.seq);
    published(threadId, said.seq);
    const thread = threads.get(threadId, now);
    if (!thread) throw new RangeError(`no thread ${threadId}`);
    const controller = new AbortController();
    const done = run(thread, text, said.seq, controller.signal).finally(() => {
      running.delete(threadId);
      publish(threadId, { type: "status", running: false });
    });
    running.set(threadId, { controller, done, by });
    publish(threadId, { type: "status", running: true });
    if (first) title(threadId, text);
    return { seq: said.seq, at: now, workspaceId: thread.workspaceId };
  };

  // The user's message, counted, and as their reason for rejecting a change
  // set when it is the next thing they said after Oriel asked what was wrong
  // with it.
  const say = (threadId: Ulid, text: string): { seq: number } => {
    const last = threads.messages(threadId).at(-1);
    const answers =
      last?.role === "note" && last.note.kind === "rejected"
        ? { rejected: last.note.changeSet }
        : undefined;
    const { seq, at, workspaceId } = start(threadId, text, { kind: "user" });
    deps.emit({ name: "question.asked", at, workspaceId, threadId, ...answers });
    return { seq };
  };

  // Whether Oriel asks what was wrong with a rejected change set now: not
  // mid-turn, once the thread can take no more questions, or of an Undo,
  // which Oriel made and the agent didn't.
  const asks = (set: Rejected) =>
    set.revertOf === null &&
    !running.has(set.threadId) &&
    capReached(threads.messages(set.threadId), deps.caps) === null;

  // Words from anyone but the user, held in the thread for them, whatever
  // the turn or the caps: the one way such words reach the agent, once the
  // user sends them (decision 0024). What shows as nothing is dropped, and
  // words that are nothing else hold nothing.
  const hold = (threadId: Ulid, from: HeldSender, words: string): void => {
    const text = words.replace(hidden, "");
    if (text.trim() === "") return;
    const held = { role: "held" as const, from, text };
    published(threadId, threads.append(threadId, held, deps.newId(), deps.now()));
    // It waits on the user now: every list hears.
    publish(threadId, { type: "status", running: running.has(threadId) });
  };

  // A turn's drafts, held in the thread for the user under its reply, each
  // with what it was drafted over (decision 0051): it waits on them as a
  // held message does.
  const holdDrafts = (threadId: Ulid, drafts: readonly { draft: Draft; over: unknown }[]) => {
    for (const { draft, over } of drafts) {
      const held = { role: "held" as const, draft, over };
      published(threadId, threads.append(threadId, held, deps.newId(), deps.now()));
      const { workspaceId } = threads.get(threadId, deps.now()) ?? {};
      if (workspaceId)
        deps.emit({
          name: "draft.made",
          at: deps.now(),
          workspaceId,
          threadId,
          action: draft.action,
        });
    }
    if (drafts.length) publish(threadId, { type: "status", running: running.has(threadId) });
  };

  // One of Oriel's own lines in the thread, with no model call: the one way
  // Oriel writes into a chat, as Oriel, never as the agent (OA-91).
  const note = (threadId: Ulid, line: OrielNote) =>
    published(
      threadId,
      threads.append(threadId, { role: "note", note: line }, deps.newId(), deps.now()),
    );

  // Oriel's line asking what was wrong with a rejected change set, naming it.
  const ask = (threadId: Ulid, changeSet: Ulid, via: "thread" | "review-link") =>
    note(threadId, { kind: "rejected", changeSet, via });

  return {
    running: (threadId: Ulid): boolean => running.has(threadId),

    holdDrafts,

    // Who started the thread's running turn, or null with none running.
    startedBy: (threadId: Ulid): Actor | null => running.get(threadId)?.by ?? null,

    // Calls `listener` with each new chat entry and status change until the
    // returned function is called.
    watch(threadId: Ulid, listener: (event: ThreadEvent) => void): () => void {
      const set = watchers.get(threadId) ?? new Set();
      set.add(listener);
      watchers.set(threadId, set);
      return () => {
        set.delete(listener);
        if (set.size === 0) watchers.delete(threadId);
      };
    },

    // Calls `listener` whenever the workspace changes, until the returned
    // function is called: with a thread's ID when its turn starts or ends, a
    // change set of it changes, or it changes outside a turn; and once for
    // each of Oriel's own actions, with the thread it changed, if any.
    watchAny(listener: (threadId: Ulid | null) => void): () => void {
      anyWatchers.add(listener);
      return () => anyWatchers.delete(listener);
    },

    // The user deleted the thread: every page watching it says so, and every
    // list drops it.
    deleted(threadId: Ulid): void {
      publish(threadId, { type: "deleted" });
    },

    // A change set of the thread started or finished applying: every page
    // watching it reloads it. `look`: only its second look changed, so its
    // diff stands and the page needn't read it again (OA-257).
    changeSet(threadId: Ulid, changeSetId: Ulid, applying: boolean, look?: true): void {
      publish(threadId, { type: "change-set", changeSetId, applying, ...(look && { look }) });
    },

    // One of Oriel's own actions changed the workspace, by whoever (decision
    // 0024): the pages watching a thread it changed hear its status; each
    // thread that moved to its workstream's newer version shows its marker; the
    // pages watching any thread of a workstream it changed hear that, moved or
    // not; and every page watching the workspace hears once, so the lists,
    // and a workstream's page, load again.
    // `chat`: an entry already in the thread's chat changed, which its pages
    // load again.
    acted(changed: {
      thread: Ulid | null;
      chat?: boolean;
      workstream: Ulid | null;
      moves: readonly Move[];
    }): void {
      if (changed.thread) {
        tell(changed.thread, { type: "status", running: running.has(changed.thread) });
        if (changed.chat) tell(changed.thread, { type: "chat" });
      }
      // An entry tells only its thread's pages.
      for (const move of changed.moves) published(move.threadId, move.seq);
      if (changed.workstream)
        for (const { thread } of threads.ofWorkstream(changed.workstream, deps.now()))
          tell(thread.id, { type: "workstream" });
      broadcast(changed.thread);
    },

    say,

    // An outside tool's words (OA-73), held in the thread for the user as
    // a review link's holder's reason is: they reach the agent only as the
    // user sends them on.
    holdFromTool(threadId: Ulid, name: string, text: string): void {
      hold(threadId, { kind: "tool", name }, text);
    },

    // An outside tool the user connected to speak for them (OA-75): its words
    // start a turn, as the user's would, under its name. The turn is the
    // tool's, so none of the agent's actions apply in it (decision 0024),
    // and only the user approves what it proposes.
    // What shows as nothing is dropped, as from a held message, so what the
    // user reads under its name is all the agent hears.
    sayAsTool(threadId: Ulid, name: string, words: string): { seq: number } {
      const text = words.replace(hidden, "");
      if (text.trim() === "") throw new RangeError("Nothing to say: the words show as nothing.");
      const { seq, at, workspaceId } = start(threadId, text, { kind: "tool", name });
      deps.emit({ name: "question.asked", at, workspaceId, threadId });
      return { seq };
    },

    // A change set of the thread was rejected. The thread says so and asks
    // what was wrong, in a line Oriel writes with no model call: the agent reads it
    // in its history, so it answers with a revised change set rather than
    // more on top of the rejected one, when it can (`asks`). The user's
    // reply is the answer (OA-145). A review link may have been forwarded to
    // anyone, so its `holder`'s reason is held in the thread under their
    // name, whatever the turn or the caps, until the person sends it on or
    // discards it; and the line the agent reads doesn't name them (decision
    // 0024).
    rejected(set: Rejected, holder: { by: string; reason: string | null } | null): void {
      const { threadId } = set;
      const asked = asks(set);
      if (asked) ask(threadId, set.id, holder === null ? "thread" : "review-link");
      if (holder === null || holder.reason === null) return;
      const from = {
        kind: "review-link",
        by: holder.by,
        changeSet: set.id,
        askFirst: !asked && set.revertOf === null,
      } as const;
      hold(threadId, from, holder.reason);
    },

    // The user undid their rejection of a change set (OA-258): the thread
    // says so in a line Oriel writes, which the agent reads in its history,
    // so the rejection it read before isn't the last word; and Oriel no
    // longer asks what was wrong. Every list hears it waits on the user.
    unrejected(set: Rejected): void {
      note(set.threadId, { kind: "unrejected", changeSet: set.id });
      publish(set.threadId, { type: "status", running: running.has(set.threadId) });
    },

    // The user sends the message held at `seq` to the agent, as it was or as
    // they edited it, whoever it is from. It goes as their message, as a
    // typed one does, so the turn and the words are theirs. Refused mid-turn
    // or past the caps, it stays held. Counting it and telling the thread's
    // pages are the dispatcher's (decision 0024).
    sendHeld(
      threadId: Ulid,
      at: number,
      text?: string,
    ): { seq: number; from: HeldSender; edited: boolean } {
      const held = threads.held(threadId).find((h) => h.seq === at);
      // A draft is applied, never sent (decision 0051).
      if (!held || !("from" in held)) throw new NothingHeld();
      if (running.has(threadId)) throw new ThreadBusy();
      // A review link's holder answers what was wrong with the change set
      // they rejected: held while Oriel couldn't ask, mid-turn, it asks
      // first, so the agent reads the reason as that answer.
      const capped = capReached(threads.messages(threadId), deps.caps) !== null;
      if (held.from.kind === "review-link" && held.from.askFirst && !capped)
        ask(threadId, held.from.changeSet, "review-link");
      const sent = text ?? held.text;
      // Sent on, the words and the turn are the user's.
      const { seq } = start(threadId, sent, { kind: "user" });
      threads.settle(threadId, at, "sent");
      return { seq, from: held.from, edited: sent !== held.text };
    },

    // The user discards the message held at `seq`: it never reaches the
    // agent. Or the draft there: it never applies.
    discardHeld(threadId: Ulid, seq: number): Held {
      const held = threads.held(threadId).find((h) => h.seq === seq);
      if (!held || !threads.settle(threadId, seq, "discarded")) throw new NothingHeld();
      return held;
    },

    // The index changed, as a sync changes it, and with it maybe a workstream's
    // name, as it follows its epic, or what the index has of its items: the
    // pages watching any thread hear their workstream changed, and every page
    // watching the workspace hears, so an open panel can tell whether its
    // item changed.
    synced(): void {
      for (const threadId of watchers.keys()) tell(threadId, { type: "workstream" });
      broadcast(null);
    },

    // Stops the thread's turn, if one is running.
    stop(threadId: Ulid): boolean {
      const turn = running.get(threadId);
      turn?.controller.abort(new Error("Stopped."));
      return turn !== undefined;
    },

    // Stops writing titles, for shutdown.
    stopTitles(): void {
      closing.abort(new Error("Closing."));
    },

    // Resolves once no turn is running and no title is being written: for
    // shutdown, and for tests.
    async settled(): Promise<void> {
      while (running.size || titling.size)
        await Promise.all([...[...running.values()].map((turn) => turn.done), ...titling]);
    },
  };
}
