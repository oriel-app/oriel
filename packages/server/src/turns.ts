// Runs threads' turns: one at a time per thread. Each event a turn emits is
// stored in the thread's chat as it arrives and passed to whoever watches
// the thread, so a turn outlives the page that started it, and a page that
// reconnects picks up from the last entry it saw. Stopping is explicit.
import { type GroupStore, type Message, type Move, type ThreadStore } from "@oriel/db";
import type { Instant, Log, TelemetryEvent, Thread, Ulid } from "@oriel/core";
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
  | { type: "group" }
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

// Why a thread can take no more questions, in plain words, or null: it has
// asked as many as a thread may; or its last turn ended on a cap, which the
// agent decides; or, as a backstop whatever agent is plugged in, it has
// spent all its tokens.
export function capReached(messages: readonly Message[], caps: Caps): string | null {
  const next = "Start a new thread on this group to keep going.";
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
  groups: GroupStore;
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
// only.
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
  const { threads, groups } = deps;
  const running = new Map<Ulid, { controller: AbortController; done: Promise<void> }>();
  const watchers = new Map<Ulid, Set<(event: ThreadEvent) => void>>();
  // Pages watching the whole workspace: every list, and a group's page.
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
  const markerText = (groupId: Ulid) => (from: number, to: number) => {
    const changes = groups.changes(groupId, from).filter((change) => change.version <= to);
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
      const region = groups.region(thread.groupId, thread.regionVersion);
      if (!region) throw new Error(`no version ${thread.regionVersion} of the thread's group`);
      const before = threads.messages(thread.id).filter((message) => message.seq < seq);
      const input = {
        thread,
        region,
        history: history(before, markerText(thread.groupId)),
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
  // returns. A settled thread catches up with its group first.
  const say = (threadId: Ulid, text: string, rejected?: Ulid): { seq: number } => {
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
    deps.emit({
      name: "question.asked",
      at: now,
      workspaceId: thread.workspaceId,
      threadId,
      ...(rejected === undefined ? {} : { rejected }),
    });
    const controller = new AbortController();
    const done = run(thread, text, said.seq, controller.signal).finally(() => {
      running.delete(threadId);
      publish(threadId, { type: "status", running: false });
    });
    running.set(threadId, { controller, done });
    publish(threadId, { type: "status", running: true });
    if (first) title(threadId, text);
    return { seq: said.seq };
  };

  return {
    running: (threadId: Ulid): boolean => running.has(threadId),

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

    // The user opened the thread without a message. Every page watching it
    // hears.
    touched(threadId: Ulid): void {
      publish(threadId, { type: "status", running: running.has(threadId) });
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
    // thread that moved to its group's newer version shows its marker; the
    // pages watching any thread of a group it changed hear that, moved or
    // not; and every page watching the workspace hears once, so the lists,
    // and a group's page, load again.
    acted(changed: { thread: Ulid | null; group: Ulid | null; moves: readonly Move[] }): void {
      if (changed.thread)
        tell(changed.thread, { type: "status", running: running.has(changed.thread) });
      // An entry tells only its thread's pages.
      for (const move of changed.moves) published(move.threadId, move.seq);
      if (changed.group)
        for (const { thread } of threads.ofGroup(changed.group, deps.now()))
          tell(thread.id, { type: "group" });
      broadcast(changed.thread);
    },

    say,

    // A change set of the thread was rejected. The thread says so and asks
    // what was wrong, in a line Oriel writes with no model call: the agent reads it
    // in its history, so it answers with a revised change set rather than
    // more on top of the rejected one. A reason is the answer, said as a
    // typed message is; one from a review link says who gave it. Mid-turn,
    // once the thread can take no more questions, or of an Undo, which Oriel
    // made and the agent didn't, it doesn't ask.
    rejected(
      set: { id: Ulid; threadId: Ulid; revertOf: Ulid | null },
      by: string | null,
      reason: string | null,
    ): void {
      const { threadId } = set;
      // It ends as a turn does, so a line after it starts its own paragraph.
      if (
        set.revertOf === null &&
        !running.has(threadId) &&
        capReached(threads.messages(threadId), deps.caps) === null
      ) {
        record(threadId, {
          kind: "text",
          text: `${by === null ? "You" : by} rejected this change set, so nothing in it will change. What was wrong with it? Say what to change, and I'll propose a revised one.`,
        });
        record(threadId, { kind: "done", usage: { inputTokens: 0, outputTokens: 0 } });
      }
      if (reason !== null)
        say(threadId, by === null ? reason : `${by}, from the review link: ${reason}`, set.id);
    },

    // The index changed, as a sync changes it, and with it maybe a group's
    // name, as it follows its epic, or what the index has of its items: the
    // pages watching any thread hear their group changed, and every page
    // watching the workspace hears, so an open panel can tell whether its
    // item changed.
    synced(): void {
      for (const threadId of watchers.keys()) tell(threadId, { type: "group" });
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
