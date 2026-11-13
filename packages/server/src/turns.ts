// Each event is stored as it arrives, so a turn outlives the page that started it,
// and a page that reconnects picks up from the last entry it saw.
import {
  type Held,
  type WorkstreamStore,
  type Message,
  type Move,
  type ThreadStore,
} from "@oriel/db";
import {
  type About,
  type Draft,
  type Actor,
  type ChangeSetState,
  type HeldSender,
  type Instant,
  type Log,
  type LookingAt,
  maxMessageChars,
  maxUnknownChips,
  type OrielNote,
  type Reader,
  type TelemetryEvent,
  type Thread,
  type Ulid,
} from "@oriel/core";
import { actionsText, capturedRules, errorText, type Titler } from "@oriel/agent";
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
  failedTurn,
  stoppedText,
} from "./agent.ts";

export type ThreadEvent =
  | { type: "message"; message: Message }
  | { type: "status"; running: boolean }
  | { type: "change-set"; changeSetId: Ulid; applying: boolean; look?: true }
  | { type: "workstream" }
  | { type: "chat" }
  | { type: "deleted" };

export class ThreadBusy extends Error {
  constructor() {
    super("The agent is still answering; stop it or wait for it to finish.");
    this.name = "ThreadBusy";
  }
}

export class ThreadLimit extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ThreadLimit";
  }
}

type Rejected = { id: Ulid; threadId: Ulid; revertOf: Ulid | null };

export type Caps = Pick<AgentLimits, "maxTurnsPerThread" | "maxTokensPerThread">;

function endedOnLimit(messages: readonly Message[]): boolean {
  const lastAsked = messages.findLastIndex((m) => m.role === "user");
  return messages.slice(lastAsked + 1).some((m) => {
    if (m.role !== "agent") return false;
    const event = agentEvent(m.event);
    return event.ok && event.value.kind === "limit";
  });
}

export class NothingFailed extends Error {
  constructor() {
    super("The thread's last turn didn't fail, so there's nothing to try again.");
    this.name = "NothingFailed";
  }
}

export class NothingHeld extends Error {
  constructor() {
    super("That message was already sent or discarded.");
    this.name = "NothingHeld";
  }
}

// Characters that show as nothing but a model reads. A held message loses them, so what the user reads is all they send.
// Variation selectors 15 and 16 and the joiners stay only where emoji and joining scripts need them.
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

export function capReached(
  messages: readonly Message[],
  caps: Caps,
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
  titler: Titler | null;
  caps: Caps;
  emit: (event: TelemetryEvent) => void;
  snapshot: () => number;
  chips: (ids: readonly string[], threadId: Ulid) => Promise<Chips>;
  read: Reader["read"];
  now: () => Instant;
  newId: () => Ulid;
  log: Log;
  alsoSpent?: (threadId: Ulid) => { inputTokens: number; outputTokens: number };
  changeSets?: (threadId: Ulid) => Promise<readonly { id: Ulid; state: ChangeSetState }[]>;
};

const maxSummaryChars = 2_000;
const maxStates = 20;

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

const plus = (
  a: { inputTokens: number; outputTokens: number },
  b: { inputTokens: number; outputTokens: number } = { inputTokens: 0, outputTokens: 0 },
) => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
});

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

// A reason held from a review link is never in it: only what the person sends on reaches the agent.
export function history(
  messages: readonly Message[],
  markerText: (from: number, to: number) => string,
): ChatMessage[] {
  const out: ChatMessage[] = [];
  const scripts = new Map<string, string>();
  // A later run that only read or failed doesn't take its place.
  let capturing: Extract<ChatMessage, { role: "run" }> | null = null;
  for (const message of messages) {
    if (message.role === "user") {
      const { text, about, at } = message;
      out.push({ role: "user", text, ...(about ? { about } : {}), at });
      continue;
    }
    if (message.role === "marker") {
      out.push({ role: "marker", text: markerText(message.from, message.to), at: message.at });
      continue;
    }
    if (message.role === "note") {
      const { note } = message;
      if (
        note.kind !== "quotes" &&
        note.kind !== "moving" &&
        note.kind !== "moved" &&
        note.kind !== "continued-in"
      )
        out.push({ role: "note", note, at: message.at });
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
    if (event.value.kind === "change-set" && capturing)
      capturing.summary += event.value.revised
        ? `; they replaced the changes of change set ${event.value.changeSetId}`
        : `; they are change set ${event.value.changeSetId}`;
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

export function quoted(messages: readonly Message[]): string {
  const said = history(messages, () => "").flatMap((m) =>
    m.role === "user"
      ? [`The user:\n${m.text}`]
      : m.role === "assistant"
        ? [`The agent:\n${m.text}`]
        : [],
  );
  const left = "(Earlier messages left out.)";
  const room = maxMessageChars - left.length - 2;
  const kept: string[] = [];
  let length = 0;
  for (const each of said.toReversed()) {
    const next = length + each.length + (kept.length > 0 ? 2 : 0);
    if (next > room) {
      if (kept.length === 0) kept.push(`…${each.slice(each.length - room + 1)}`);
      break;
    }
    kept.unshift(each);
    length = next;
  }
  const all = kept.join("\n\n");
  return kept.length < said.length ? `${left}\n\n${all}` : all;
}

export type Turns = ReturnType<typeof turns>;

export function turns(deps: TurnDeps) {
  const { threads, workstreams } = deps;
  const running = new Map<Ulid, { controller: AbortController; done: Promise<void>; by: Actor }>();
  const watchers = new Map<Ulid, Set<(event: ThreadEvent) => void>>();
  const anyWatchers = new Set<(threadId: Ulid | null) => void>();
  const everyWatchers = new Set<(threadId: Ulid) => void>();
  const titling = new Set<Promise<void>>();
  const untitled = new Map<Ulid, string>();
  const closing = new AbortController();

  const tell = (threadId: Ulid, event: ThreadEvent) => {
    for (const watcher of watchers.get(threadId) ?? []) watcher(event);
    for (const watcher of everyWatchers) watcher(threadId);
  };
  const broadcast = (threadId: Ulid | null) => {
    for (const watcher of anyWatchers) watcher(threadId);
  };
  const publish = (threadId: Ulid, event: ThreadEvent) => {
    tell(threadId, event);
    if (event.type !== "message") broadcast(threadId);
  };
  const published = (threadId: Ulid, seq: number) => {
    const message = threads.messages(threadId, seq - 1).find((m) => m.seq === seq);
    if (message) publish(threadId, { type: "message", message });
  };

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

  const landed = (threadId: Ulid, written: string) => {
    if (!threads.get(threadId, deps.now())) return;
    threads.setTitle(threadId, written, deps.now());
    const thread = threads.get(threadId, deps.now());
    const workstream = thread && workstreams.get(thread.workstreamId);
    if (workstream?.origin.kind === "window")
      workstreams.rename(workstream.id, nameOf(written), "oriel");
    publish(threadId, { type: "status", running: running.has(threadId) });
  };

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
        landed(threadId, written);
      })
      .catch((error: unknown) => {
        if (signal.aborted) return;
        log("title: failed", { error: errorText(error) });
        untitled.set(threadId, text);
      });
    titling.add(done);
    void done.finally(() => titling.delete(done));
  };

  // The agent ends each turn with one `done`; one that throws gets an error and a `done` here.
  const run = async (
    thread: Thread,
    said: { text: string; about: About | null },
    seq: number,
    signal: AbortSignal,
  ) => {
    const log: Log = (message, fields) => deps.log(message, { ...fields, thread_id: thread.id });
    let done = false;
    let failed = false;
    try {
      const region = workstreams.region(thread.workstreamId, thread.regionVersion);
      if (!region) throw new Error(`no version ${thread.regionVersion} of the thread's workstream`);
      const before = threads.messages(thread.id).filter((message) => message.seq < seq);
      const sets = (await deps.changeSets?.(thread.id)) ?? [];
      const states = sets.length
        ? [{ role: "states" as const, changeSets: sets.slice(0, maxStates), at: deps.now() }]
        : [];
      const input = {
        thread,
        region,
        history: [...history(before, markerText(thread.workstreamId)), ...states],
        text: said.text,
        ...(said.about ? { about: said.about } : {}),
        ...(threads.isWindowChat(thread.id) ? { windowChat: true as const } : {}),
        snapshot: deps.snapshot(),
        spent: plus(spent(before), deps.alsoSpent?.(thread.id)),
      };
      for await (const event of deps.agent.turn(input, { signal, log })) {
        record(thread.id, event);
        if (event.kind === "done") done = true;
        if (event.kind === "error") failed = true;
      }
    } catch (error) {
      failed = true;
      const message = errorText(error);
      log("turn: failed", { error: message });
      if (!signal.aborted)
        record(thread.id, {
          kind: "error",
          message: `The agent stopped with an error: ${message}`,
        });
      if (!done) record(thread.id, { kind: "done", usage: { inputTokens: 0, outputTokens: 0 } });
    }
    if (signal.aborted) record(thread.id, { kind: "error", message: stoppedText });
    const first = untitled.get(thread.id);
    if (first !== undefined && !failed && !signal.aborted) {
      untitled.delete(thread.id);
      title(thread.id, first);
    }
    const answers = history(
      threads.messages(thread.id).filter((message) => message.seq > seq),
      () => "",
    ).flatMap((message) => (message.role === "assistant" ? [message.text] : []));
    const unchecked = (what: string) => (error: unknown) =>
      log(`turn: ${what} unchecked`, { error: errorText(error) });
    await unknownChips(thread, answers).catch(unchecked("chips"));
    await quotes(thread, answers).catch(unchecked("quotes"));
  };

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

  // Noted before the turn is over, so the page that reloads then has it.
  const quotes = async (thread: Thread, answers: readonly string[]) => {
    const checked = await checkQuotes(answers, deps.read);
    if (checked.length === 0 || !threads.get(thread.id, deps.now())) return;
    note(thread.id, { kind: "quotes", checked });
  };

  const marked =
    (looking: LookingAt) =>
    (version: number, workstreamId: Ulid): About => {
      const members = new Set(
        workstreams.region(workstreamId, version)?.items.map((item) => item.id) ?? [],
      );
      return looking.map(({ id, under }) => ({ id, outside: !members.has(id), under }));
    };

  // The per-thread caps hold whatever agent is plugged in (SPEC §9).
  const capped = (threadId: Ulid, earlier: readonly Message[]) => {
    const reason = capReached(earlier, deps.caps, deps.alsoSpent?.(threadId));
    if (reason !== null) {
      const last = earlier.at(-1);
      const said = last?.role === "agent" && agentEvent(last.event);
      if (!(said && said.ok && said.value.kind === "limit" && said.value.reason === reason))
        record(threadId, { kind: "limit", reason });
      throw new ThreadLimit(reason);
    }
  };

  const launch = (
    thread: Thread,
    said: { text: string; about: About | null },
    seq: number,
    by: Actor,
  ) => {
    const controller = new AbortController();
    const done = run(thread, said, seq, controller.signal).finally(() => {
      running.delete(thread.id);
      publish(thread.id, { type: "status", running: false });
    });
    running.set(thread.id, { controller, done, by });
    publish(thread.id, { type: "status", running: true });
  };

  const start = (
    threadId: Ulid,
    text: string,
    by: Actor,
    looking?: LookingAt,
  ): { seq: number; at: Instant; workspaceId: Ulid } => {
    if (running.has(threadId)) throw new ThreadBusy();
    const earlier = threads.messages(threadId);
    capped(threadId, earlier);
    const first = !earlier.some((m) => m.role === "user");
    const now = deps.now();
    const ids = { marker: deps.newId(), message: deps.newId() };
    const said = threads.say(threadId, text, ids, now, looking && marked(looking));
    if (said.move) published(threadId, said.move.seq);
    published(threadId, said.seq);
    const thread = threads.get(threadId, now);
    if (!thread) throw new RangeError(`no thread ${threadId}`);
    const stored = threads.messages(threadId, said.seq - 1).find((m) => m.seq === said.seq);
    const about = stored?.role === "user" ? (stored.about ?? null) : null;
    launch(thread, { text, about }, said.seq, by);
    if (first && threads.title(threadId) === null) title(threadId, text);
    return { seq: said.seq, at: now, workspaceId: thread.workspaceId };
  };

  const say = (threadId: Ulid, text: string, looking?: LookingAt): { seq: number } => {
    const last = threads.messages(threadId).at(-1);
    const answers =
      last?.role === "note" && last.note.kind === "rejected"
        ? { rejected: last.note.changeSet }
        : undefined;
    const { seq, at, workspaceId } = start(threadId, text, { kind: "user" }, looking);
    deps.emit({ name: "question.asked", at, workspaceId, threadId, ...answers });
    return { seq };
  };

  const asks = (set: Rejected) =>
    set.revertOf === null &&
    !running.has(set.threadId) &&
    capReached(threads.messages(set.threadId), deps.caps) === null;

  // The one way words from anyone but the user reach the agent, once the user sends them.
  const hold = (threadId: Ulid, from: HeldSender, words: string): void => {
    const text = words.replace(hidden, "");
    if (text.trim() === "") return;
    const held = { role: "held" as const, from, text };
    published(threadId, threads.append(threadId, held, deps.newId(), deps.now()));
    publish(threadId, { type: "status", running: running.has(threadId) });
  };

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

  // As Oriel, never as the agent.
  const note = (threadId: Ulid, line: OrielNote) =>
    published(
      threadId,
      threads.append(threadId, { role: "note", note: line }, deps.newId(), deps.now()),
    );

  const ask = (threadId: Ulid, changeSet: Ulid, via: "thread" | "review-link") =>
    note(threadId, { kind: "rejected", changeSet, via });

  return {
    running: (threadId: Ulid): boolean => running.has(threadId),

    holdDrafts,

    carry(threadId: Ulid, from: Extract<HeldSender, { kind: "window-chat" }>, text: string) {
      hold(threadId, from, text);
      const held = threads.held(threadId).at(-1);
      return held ? this.sendHeld(threadId, held.seq) : null;
    },

    startedBy: (threadId: Ulid): Actor | null => running.get(threadId)?.by ?? null,

    watch(threadId: Ulid, listener: (event: ThreadEvent) => void): () => void {
      const set = watchers.get(threadId) ?? new Set();
      set.add(listener);
      watchers.set(threadId, set);
      return () => {
        set.delete(listener);
        if (set.size === 0) watchers.delete(threadId);
      };
    },

    watchAny(listener: (threadId: Ulid | null) => void): () => void {
      anyWatchers.add(listener);
      return () => anyWatchers.delete(listener);
    },

    watchEvery(listener: (threadId: Ulid) => void): () => void {
      everyWatchers.add(listener);
      return () => everyWatchers.delete(listener);
    },

    deleted(threadId: Ulid): void {
      publish(threadId, { type: "deleted" });
    },

    changeSet(threadId: Ulid, changeSetId: Ulid, applying: boolean, look?: true): void {
      publish(threadId, { type: "change-set", changeSetId, applying, ...(look && { look }) });
    },

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
      for (const move of changed.moves) published(move.threadId, move.seq);
      if (changed.workstream)
        for (const { thread } of threads.ofWorkstream(changed.workstream, deps.now()))
          tell(thread.id, { type: "workstream" });
      broadcast(changed.thread);
    },

    say,

    titled: landed,

    // The agent reads Oriel's line, so it revises the rejected change set rather than adding to it.
    // A review link may have been forwarded to anyone: the holder's reason is held for the user,
    // and the agent's line doesn't name them.
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

    unrejected(set: Rejected): void {
      note(set.threadId, { kind: "unrejected", changeSet: set.id });
      publish(set.threadId, { type: "status", running: running.has(set.threadId) });
    },

    continued(from: Ulid, to: Ulid): void {
      hold(to, { kind: "thread", thread: from }, quoted(threads.messages(from)));
      note(from, { kind: "continued-in", thread: to });
      publish(from, { type: "status", running: running.has(from) });
    },

    sendHeld(
      threadId: Ulid,
      at: number,
      text?: string,
    ): { seq: number; from: HeldSender; edited: boolean } {
      const held = threads.held(threadId).find((h) => h.seq === at);
      if (!held || !("from" in held)) throw new NothingHeld();
      if (running.has(threadId)) throw new ThreadBusy();
      const sent = text ?? held.text;
      // Never the user's words, so it starts no turn.
      if (held.from.kind === "thread") {
        const quote = { kind: "continued" as const, thread: held.from.thread, quote: sent };
        const seq = threads.append(
          threadId,
          { role: "note", note: quote },
          deps.newId(),
          deps.now(),
        );
        threads.settle(threadId, at, "sent");
        published(threadId, seq);
        publish(threadId, { type: "status", running: false });
        return { seq, from: held.from, edited: sent !== held.text };
      }
      // Held while Oriel couldn't ask, mid-turn: it asks first, so the agent reads the reason as that answer.
      const capped = capReached(threads.messages(threadId), deps.caps) !== null;
      if (held.from.kind === "review-link" && held.from.askFirst && !capped)
        ask(threadId, held.from.changeSet, "review-link");
      const about = held.from.kind === "window-chat" ? held.from.about : undefined;
      const { seq } = start(threadId, sent, { kind: "user" }, about);
      threads.settle(threadId, at, "sent");
      return { seq, from: held.from, edited: sent !== held.text };
    },

    discardHeld(threadId: Ulid, seq: number): Held {
      const held = threads.held(threadId).find((h) => h.seq === seq);
      if (!held || !threads.settle(threadId, seq, "discarded")) throw new NothingHeld();
      return held;
    },

    synced(): void {
      for (const threadId of watchers.keys()) tell(threadId, { type: "workstream" });
      broadcast(null);
    },

    retry(threadId: Ulid): { seq: number } {
      if (running.has(threadId)) throw new ThreadBusy();
      const earlier = threads.messages(threadId);
      const failed = failedTurn(earlier);
      if (!failed) throw new NothingFailed();
      // The question is asked already: only what came before it counts.
      capped(
        threadId,
        earlier.filter((message) => message.seq < failed.said.seq),
      );
      const thread = threads.get(threadId, deps.now());
      if (!thread) throw new RangeError(`no thread ${threadId}`);
      const { text, about, seq } = failed.said;
      launch(thread, { text, about: about ?? null }, seq, { kind: "user" });
      return { seq };
    },

    stop(threadId: Ulid): boolean {
      const turn = running.get(threadId);
      turn?.controller.abort(new Error(stoppedText));
      return turn !== undefined;
    },

    stopTitles(): void {
      closing.abort(new Error("Closing."));
    },

    async settled(): Promise<void> {
      while (running.size || titling.size)
        await Promise.all([...[...running.values()].map((turn) => turn.done), ...titling]);
    },
  };
}
