// What a calling program hears of a thread (the mcp-agents spike): who said
// what, the agent's reply to each turn once it ends, each change set and
// where it stands, and what the thread waits on, since a cursor it was
// given. `thread_wait` waits for news, up to a timeout; a task (the tasks
// extension) and the thread's resource read the same. Nothing here acts:
// only a person decides a change set, in the window.
import type { Actor, ChangeSetRead, Intent, Ulid } from "@oriel/core";
import type { Message } from "@oriel/db";
import { agentEvent } from "../agent.ts";
import type { Outside } from "./door.ts";
import type { ConnectedTool } from "./tokens.ts";

// Where a program left off: the chat's last entry it heard, each change
// set's state, and each held message's outcome. Opaque to the program.
export type Cursor = { seq: number; sets: Record<string, string>; held: Record<string, string> };
const start: Cursor = { seq: 0, sets: {}, held: {} };

export const encodeCursor = (cursor: Cursor): string =>
  Buffer.from(JSON.stringify(cursor)).toString("base64url");
export function decodeCursor(text: unknown): Cursor {
  if (typeof text !== "string") return start;
  try {
    const value = JSON.parse(Buffer.from(text, "base64url").toString("utf8")) as Partial<Cursor>;
    const record = (v: unknown) =>
      typeof v === "object" && v !== null ? (v as Record<string, string>) : {};
    return {
      seq: typeof value.seq === "number" ? value.seq : 0,
      sets: record(value.sets),
      held: record(value.held),
    };
  } catch {
    return start;
  }
}

// Who someone is, to the program reading: itself, the user, or another
// tool by the name the user gave it.
type Who = "you" | "the user" | (string & {});
const whoOf = (by: { kind: "tool"; name: string } | undefined, asker: ConnectedTool): Who =>
  by === undefined ? "the user" : by.name === asker.name ? "you" : by.name;

export type Heard =
  | { kind: "asked"; seq: number; by: Who }
  | { kind: "held"; seq: number; from: Who; outcome: "waiting" | "sent" | "discarded" }
  // The agent's answer to the turn `asked` started, once it ended.
  | {
      kind: "reply";
      asked: number;
      to: Who;
      text: string;
      changeSets: Ulid[];
      // What Oriel did of what the agent asked, as the window lists it
      // under the reply: each call, and whether it applied or why not.
      actions: { call: Intent; applied: boolean; undone?: true; why?: string }[];
      error?: string;
    }
  | {
      kind: "change-set";
      id: Ulid;
      state: ChangeSetRead["state"];
      decided: ChangeSetRead["decided"];
      changes: string[];
      link: string;
    };

export type ThreadNews = {
  thread: { id: Ulid; title: string | null; workstream: Ulid; link: string };
  // Who the thread waits on now, in a few words.
  waitingOn: string;
  heard: Heard[];
  cursor: string;
};

// What ends a wait: an answer, a held message settling, or a change set
// moving. Who asked something is news, but not enough to stop waiting; nor
// is an approval, whose apply follows in moments: the wait ends as it lands.
// A program's own words, just held, it knows of already.
export const ends = (heard: readonly Heard[]) =>
  heard.some(
    (each) =>
      each.kind !== "asked" &&
      !(each.kind === "change-set" && each.state === "approved") &&
      !(each.kind === "held" && each.outcome === "waiting" && each.from === "you"),
  );

type Turn = { asked: Message & { role: "user" }; entries: Message[]; done: Message | null };

// The chat's turns: each user message, the entries after it, and its `done`.
function turnsOf(messages: readonly Message[]): Turn[] {
  const turns: Turn[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      turns.push({ asked: message, entries: [], done: null });
      continue;
    }
    const turn = turns.at(-1);
    if (!turn || turn.done) continue;
    turn.entries.push(message);
    if (message.role !== "agent") continue;
    const event = agentEvent(message.event);
    if (event.ok && event.value.kind === "done") turn.done = message;
  }
  return turns;
}

function replyOf(turn: Turn, asker: ConnectedTool): Heard {
  let text = "";
  let error: string | undefined;
  const changeSets: Ulid[] = [];
  const actions: Extract<Heard, { kind: "reply" }>["actions"] = [];
  for (const entry of turn.entries) {
    if (entry.role !== "agent") continue;
    const event = agentEvent(entry.event);
    if (!event.ok) continue;
    if (event.value.kind === "text") text += event.value.text;
    if (event.value.kind === "change-set") changeSets.push(event.value.changeSetId);
    if (event.value.kind === "actions")
      for (const line of event.value.lines)
        actions.push({
          call: line.call,
          applied: line.applied,
          ...(line.applied
            ? line.since?.undone
              ? { undone: true as const }
              : {}
            : { why: line.why }),
        });
    if (event.value.kind === "error" || event.value.kind === "limit")
      error = "message" in event.value ? event.value.message : event.value.reason;
  }
  return {
    kind: "reply",
    asked: turn.asked.seq,
    to: whoOf(turn.asked.by, asker),
    text,
    changeSets,
    actions,
    ...(error === undefined ? {} : { error }),
  };
}

const whose = (turn: Actor, asker: ConnectedTool): Who =>
  turn.kind === "tool" ? (turn.name === asker.name ? "you" : turn.name) : "the user";

// The thread as `asker` hears it since `after`, or null for one the
// workspace doesn't have.
export async function threadNews(
  outside: Outside,
  window: URL,
  id: Ulid,
  asker: ConnectedTool,
  after: Cursor,
): Promise<ThreadNews | null> {
  const chat = outside.chat(id);
  if (!chat) return null;
  const { thread, messages, turn } = chat;
  const sets = await outside.reads.changeSets(thread.id);
  const title = (await outside.reads.threads()).find((each) => each.id === thread.id)?.name;
  const link = new URL(`threads/${thread.id}`, window).href;
  const heard: Heard[] = [];
  for (const each of turnsOf(messages)) {
    if (each.asked.seq > after.seq)
      heard.push({ kind: "asked", seq: each.asked.seq, by: whoOf(each.asked.by, asker) });
    if (each.done && each.done.seq > after.seq) heard.push(replyOf(each, asker));
  }
  const held: Record<string, string> = {};
  let yoursHeld = false;
  for (const message of messages) {
    if (message.role !== "held" || !("from" in message) || message.from.kind !== "tool") continue;
    const outcome = message.outcome ?? "waiting";
    held[message.seq] = outcome;
    const from = message.from.name === asker.name ? "you" : message.from.name;
    if (from === "you" && outcome === "waiting") yoursHeld = true;
    if (after.held[message.seq] !== outcome)
      heard.push({ kind: "held", seq: message.seq, from, outcome });
  }
  const states: Record<string, string> = {};
  for (const set of sets.toReversed()) {
    states[set.id] = set.state;
    if (after.sets[set.id] !== set.state)
      heard.push({
        kind: "change-set",
        id: set.id,
        state: set.state,
        decided: set.decided,
        changes: set.changes.map((change) => change.sentence),
        link,
      });
  }
  const pending = sets.some((set) => set.state === "pending");
  const waitingOn = turn
    ? `the agent, answering ${whose(turn, asker) === "you" ? "you" : whose(turn, asker)}`
    : yoursHeld
      ? "the user, to send your words on to the agent"
      : pending
        ? "the user, to approve or reject a change set"
        : sets.some((set) => set.state === "approved")
          ? "Oriel, applying an approved change set"
          : thread.state !== "working"
            ? `nobody: the thread is ${thread.state.replace("-", " ")}`
            : "you, or the user: the agent has answered";
  const seq = messages.at(-1)?.seq ?? 0;
  return {
    thread: { id: thread.id, title: title ?? null, workstream: thread.workstreamId, link },
    waitingOn,
    heard,
    cursor: encodeCursor({ seq, sets: states, held }),
  };
}

// Calls `then` once `ms` have passed, unless the call it gives back cancels
// that first.
export type Later = (ms: number, then: () => void) => () => void;
const timer: Later = (ms, then) => {
  const id = setTimeout(then, ms);
  return () => clearTimeout(id);
};

// News of the thread since `after`, as soon as there is any, or what there
// is once `ms` pass with none. `signal` ends the wait early, as a client
// that left does.
export async function waitForNews(
  outside: Outside,
  window: URL,
  id: Ulid,
  asker: ConnectedTool,
  after: Cursor,
  ms: number,
  signal?: AbortSignal,
  later: Later = timer,
): Promise<(ThreadNews & { timedOut: boolean }) | null> {
  const now = await threadNews(outside, window, id, asker, after);
  if (!now || ends(now.heard) || ms <= 0) return now && { ...now, timedOut: false };
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const cancel = later(ms, () => resolve(true));
  const stopped = () => resolve(true);
  signal?.addEventListener("abort", stopped, { once: true });
  let checking = Promise.resolve();
  const stop = outside.watchThread(id, (event) => {
    if (event.type === "deleted") return resolve(false);
    // In order, so a later check never answers before an earlier one.
    checking = checking
      .then(async () => {
        const news = await threadNews(outside, window, id, asker, after);
        if (!news || ends(news.heard)) resolve(false);
      })
      // One that fails ends the wait, which reads the thread once more.
      .catch(() => resolve(false));
  });
  const timedOut = await promise;
  cancel();
  signal?.removeEventListener("abort", stopped);
  stop();
  const news = await threadNews(outside, window, id, asker, after);
  return news && { ...news, timedOut };
}
