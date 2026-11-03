// Desktop notifications (OA-184): when a thread newly waits on the person (a
// change set to review, an answer waiting for their reply, a held message,
// or an apply stalled), the desktop app's shell notifies, if Settings has it
// on. The shell shows it only while its window isn't in front, and a click
// opens the thread. The window chat, as in Needs you, waits on the person
// only for a change set or a held message, never for an answer. The wording
// is Oriel's own; the thread's title, which may
// come from synced content, is the body, as plain text. Threads already
// waiting when the server starts, or while notifications are off, say
// nothing.
import type { Log } from "@oriel/core";
import { type ThreadSummaryView, type WaitingOn, waitsOnUser } from "@oriel/web/view";

export type Notice = { title: string; body: string; open: string };
export type Notify = (notice: Notice) => Promise<void>;

const titles: Partial<Record<WaitingOn, string>> = {
  review: "A change set waits for your review",
  reply: "Oriel answered, and it's your turn",
  held: "A message waits for you",
  stalled: "A change set stopped while it was being applied",
};

// What newly waits on the person since `before`, and how each thread waits
// now, for next time. A thread that waits on them in a new way, such as a
// change set after an answer, is new again. A thread with no title has no
// message yet, and has only just been made: its turn is about to start, so
// it waits on nothing.
export function newlyWaiting(
  before: ReadonlyMap<string, WaitingOn>,
  threads: readonly ThreadSummaryView[],
): { now: Map<string, WaitingOn>; notices: Notice[] } {
  const now = new Map<string, WaitingOn>();
  const notices: Notice[] = [];
  for (const thread of threads) {
    if (!waitsOnUser(thread.waitingOn) || thread.waitingOn === null || thread.title === null)
      continue;
    now.set(thread.id, thread.waitingOn);
    if (before.get(thread.id) === thread.waitingOn) continue;
    notices.push({
      title: titles[thread.waitingOn] ?? "A thread waits for you",
      body: thread.title,
      open: `/threads/${thread.id}`,
    });
  }
  return { now, notices };
}

export type Notifier = {
  // The workspace changed: look again, after any look still running.
  changed(): void;
  // Resolves once no look is running or queued.
  idle(): Promise<void>;
  // Waits for the last look, and looks no more.
  stop(): Promise<void>;
};

export async function notifier(deps: {
  threads(): Promise<ThreadSummaryView[]>;
  on(): boolean;
  notify: Notify;
  log: Log;
}): Promise<Notifier> {
  let before = newlyWaiting(new Map(), await deps.threads()).now;
  let stopped = false;
  let queued = false;
  let running: Promise<void> = Promise.resolve();
  const look = async () => {
    queued = false;
    if (stopped) return;
    const { now, notices } = newlyWaiting(before, await deps.threads());
    before = now;
    if (!deps.on()) return;
    for (const notice of notices)
      // Never the notice itself: its body is a thread's title.
      deps.notify(notice).catch(() => deps.log("notify: the shell didn't show it", {}));
  };
  return {
    changed() {
      if (queued || stopped) return;
      queued = true;
      running = running
        .then(look)
        .catch((error: unknown) => deps.log("notify: couldn't look", { error: String(error) }));
    },
    idle: () => running,
    async stop() {
      stopped = true;
      await running;
    },
  };
}
