// Runs threads' turns: one at a time per thread. Each event a turn emits is
// stored in the thread's chat as it arrives and passed to whoever watches
// the thread, so a turn outlives the page that started it, and a page that
// reconnects picks up from the last entry it saw. Stopping is explicit.
import { type WorkstreamStore, type Message, type Move, type ThreadStore } from "@oriel/db";
import type {
  ActionLine,
  Actor,
  HeldSender,
  Instant,
  Log,
  TelemetryEvent,
  Thread,
  Ulid,
} from "@oriel/core";
import type { Titler } from "@oriel/agent";
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
  | { type: "change-set"; changeSetId: Ulid; applying: boolean }
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
export function capReached(messages: readonly Message[], caps: Caps): string | null {
  const next = "Start a new thread on this workstream to keep going.";
  const asked = messages.filter((m) => m.role === "user").length;
  if (asked >= caps.maxTurnsPerThread)
    return `This thread has had all ${caps.maxTurnsPerThread} of its questions. ${next}`;
  const used = spent(messages);
  if (endedOnLimit(messages) || used.inputTokens + used.outputTokens >= caps.maxTokensPerThread)
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
  now: () => Instant;
  newId: () => Ulid;
  log: Log;
};

const maxSummaryChars = 2_000;

// A run as history keeps it: how it ended and what it returned or why it
// failed, cut short.
function runSummary(event: Extract<AgentEvent, { kind: "run.finished" }>): string {
  const { result } = event;
  const last = result.transcript.at(-1);
  const detail =
    last?.kind === "return"
      ? `returned ${JSON.stringify(last.value) ?? "undefined"}`
      : last?.kind === "error"
        ? `failed: ${last.error.message}`
        : "returned nothing";
  const captured = result.mutations.length ? `; captured ${result.mutations.length} changes` : "";
  const text = `${result.outcome}; ${detail}${captured}`;
  return text.length > maxSummaryChars ? `${text.slice(0, maxSummaryChars - 1)}…` : text;
}

// What the agent reads of the host's list under a reply: each call as it
// applied or was refused, by ID, never by name.
const actionsText = (lines: readonly ActionLine[]): string =>
  lines
    .map((line) => {
      const call = JSON.stringify(line.call);
      if (!line.applied) return `refused ${call}: ${line.why}`;
      return `applied ${call}${line.since?.undone ? ", which the user then undid" : ""}`;
    })
    .join("\n");

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
// joined up, each run's script and summary, and markers naming items by ID
// only. A reason held from a review link is never in it: only what the
// person sends on reaches the agent, as their own message (decision 0024).
export function history(
  messages: readonly Message[],
  markerText: (from: number, to: number) => string,
): ChatMessage[] {
  const out: ChatMessage[] = [];
  const scripts = new Map<string, string>();
  let ended = false;
  for (const message of messages) {
    if (message.role === "user") {
      out.push({ role: "user", text: message.text, at: message.at });
      continue;
    }
    if (message.role === "marker") {
      out.push({ role: "marker", text: markerText(message.from, message.to), at: message.at });
      continue;
    }
    if (message.role === "held") continue;
    const event = agentEvent(message.event);
    if (!event.ok) continue;
    const last = out.at(-1);
    if (event.value.kind === "text") {
      // Text after a turn ended, as Oriel's line after a rejection, is a new
      // paragraph of what the agent last said.
      if (last?.role === "assistant") last.text += `${ended ? "\n\n" : ""}${event.value.text}`;
      else out.push({ role: "assistant", text: event.value.text, at: message.at });
      ended = false;
    }
    if (event.value.kind === "done") ended = true;
    if (event.value.kind === "actions")
      out.push({ role: "actions", text: actionsText(event.value.lines), at: message.at });
    if (event.value.kind === "run.started") scripts.set(event.value.runId, event.value.script);
    if (event.value.kind === "run.finished") {
      const script = scripts.get(event.value.runId);
      out.push({
        role: "run",
        runId: event.value.runId,
        summary: runSummary(event.value),
        ...(script === undefined ? {} : { script }),
        at: message.at,
      });
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

  const record = (threadId: Ulid, event: AgentEvent) => {
    const seq = threads.append(threadId, { role: "agent", event }, deps.newId(), deps.now());
    published(threadId, seq);
    if (event.kind === "search") {
      const thread = threads.get(threadId, deps.now());
      if (thread)
        deps.emit({
          name: "escape-hatch.used",
          at: deps.now(),
          workspaceId: thread.workspaceId,
          threadId,
          runId: event.runId,
        });
    }
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
        spent: spent(before),
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
    const reason = capReached(earlier, deps.caps);
    if (reason !== null) {
      const last = earlier.at(-1);
      const said = last?.role === "agent" && agentEvent(last.event);
      if (!(said && said.ok && said.value.kind === "limit" && said.value.reason === reason))
        record(threadId, { kind: "limit", reason });
      throw new ThreadLimit(reason);
    }
    const first = !earlier.some((m) => m.role === "user");
    const now = deps.now();
    const said = threads.say(threadId, text, { marker: deps.newId(), message: deps.newId() }, now);
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

  // The user's message, counted. `cause` says it was their reason for
  // rejecting a change set.
  const say = (threadId: Ulid, text: string, cause?: { rejected: Ulid }): { seq: number } => {
    const { seq, at, workspaceId } = start(threadId, text, { kind: "user" });
    deps.emit({ name: "question.asked", at, workspaceId, threadId, ...cause });
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

  // Oriel's line asking what was wrong, with no model call. It ends as a
  // turn does, so a line after it starts its own paragraph.
  const ask = (threadId: Ulid, yours: boolean) => {
    record(threadId, {
      kind: "text",
      text: `${yours ? "You rejected this change set" : "This change set was rejected on its review link"}, so nothing in it will change. What was wrong with it? Say what to change, and I'll propose a revised one.`,
    });
    record(threadId, { kind: "done", usage: { inputTokens: 0, outputTokens: 0 } });
  };

  return {
    running: (threadId: Ulid): boolean => running.has(threadId),

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
    // watching it reloads it.
    changeSet(threadId: Ulid, changeSetId: Ulid, applying: boolean): void {
      publish(threadId, { type: "change-set", changeSetId, applying });
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

    // A change set of the thread was rejected. The thread says so and asks
    // what was wrong, in a line Oriel writes with no model call: the agent reads it
    // in its history, so it answers with a revised change set rather than
    // more on top of the rejected one, when it can (`asks`). The person's own
    // reason is the answer, said as a typed message is. A review link may
    // have been forwarded to anyone, so its holder's reason is held in the
    // thread under their name, whatever the turn or the caps, until the
    // person sends it on or discards it; and the line the agent reads
    // doesn't name them (decision 0024).
    rejected(set: Rejected, by: string | null, reason: string | null): void {
      const { threadId } = set;
      const asked = asks(set);
      if (asked) ask(threadId, by === null);
      if (reason === null) return;
      if (by === null) {
        say(threadId, reason, { rejected: set.id });
        return;
      }
      const from = {
        kind: "review-link",
        by,
        changeSet: set.id,
        askFirst: !asked && set.revertOf === null,
      } as const;
      hold(threadId, from, reason);
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
      if (!held) throw new NothingHeld();
      if (running.has(threadId)) throw new ThreadBusy();
      // A review link's holder answers what was wrong with the change set
      // they rejected: held while Oriel couldn't ask, mid-turn, it asks
      // first, so the agent reads the reason as that answer.
      const capped = capReached(threads.messages(threadId), deps.caps) !== null;
      if (held.from.kind === "review-link" && held.from.askFirst && !capped) ask(threadId, false);
      const sent = text ?? held.text;
      // Sent on, the words and the turn are the user's.
      const { seq } = start(threadId, sent, { kind: "user" });
      threads.settle(threadId, at, "sent");
      return { seq, from: held.from, edited: sent !== held.text };
    },

    // The user discards the message held at `seq`: it never reaches the
    // agent.
    discardHeld(threadId: Ulid, seq: number): HeldSender {
      const held = threads.held(threadId).find((h) => h.seq === seq);
      if (!held || !threads.settle(threadId, seq, "discarded")) throw new NothingHeld();
      return held.from;
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
