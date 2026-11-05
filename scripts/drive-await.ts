// `pnpm drive await <thread>`: block until the maintainer decides the
// thread's change sets awaiting review, then exit. It listens to the thread's
// event stream and, after each event, reads the thread's state and decides
// from that. It reads state only: it never approves, applies or rejects
// (decision 0003). It prints change-set IDs and statuses, never synced content.
import { setTimeout as wait } from "node:timers/promises";

// The exit codes, listed in scripts/drive.ts's header. 2 is a usage error
// and 3 a refusal, as for every drive command.
export const exits = { decided: 0, nothing: 4, unfinished: 5, timedOut: 6, serverGone: 7 };

type ChangeSet = { id: string; status: string };
export type Outcome = { code: number; lines: string[] };

// The change sets awaiting review: those still open.
export const awaiting = (sets: readonly ChangeSet[]): string[] =>
  sets.filter((set) => set.status === "open").map((set) => set.id);

// What the wait comes to, given the change sets it waits on and the thread's
// change sets now (null: the thread is gone), or null while any is undecided.
// One a person approved that is still being applied waits on; one whose
// apply stopped partway, or gone with its thread, ends the wait unfinished.
export function settle(
  waited: readonly string[],
  sets: readonly ChangeSet[] | null,
): Outcome | null {
  const lines: string[] = [];
  let code = exits.decided;
  for (const id of waited) {
    const status = sets === null ? "gone" : (sets.find((set) => set.id === id)?.status ?? "gone");
    if (status === "open" || status === "approved" || status === "applying") return null;
    if (status !== "applied" && status !== "rejected") code = exits.unfinished;
    lines.push(`${status} ${id}`);
  }
  return { code, lines };
}

export type Asked = { thread: string; minutes: number };

// `<thread> [--timeout <minutes>]`, or why not.
export function parseAwait(args: readonly string[]): Asked | string {
  const [thread, ...rest] = args;
  if (thread === undefined || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(thread))
    return "await needs a thread ID";
  if (rest.length === 0) return { thread, minutes: 60 };
  const minutes = Number(rest[1]);
  if (rest.length !== 2 || rest[0] !== "--timeout" || !(minutes > 0))
    return "await takes <thread> [--timeout <minutes>]";
  return { thread, minutes };
}

// The server answering, as the stream's `retry: 2000` asks, and how long it
// may stay gone before the wait gives up: a restart takes seconds.
const retry = 2_000;
const goneFor = 120_000;

class Gone extends Error {}
class TimedOut extends Error {}

export async function awaitDecision(app: string, asked: Asked): Promise<Outcome> {
  const deadline = Date.now() + asked.minutes * 60_000;
  let downSince: number | null = null;
  // Each call to the server, again while it is down, until it's been down too long.
  async function reach<T>(call: () => Promise<T>): Promise<T> {
    for (;;) {
      try {
        const answer = await call();
        downSince = null;
        return answer;
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        downSince ??= Date.now();
        if (Date.now() - downSince > goneFor) throw new Gone();
        if (Date.now() + retry > deadline) throw new TimedOut();
        await wait(retry);
      }
    }
  }
  const sets = () =>
    reach(async () => {
      // No longer than the wait: a server that hangs times it out too.
      const reply = await fetch(new URL(`/api/threads/${asked.thread}`, app), {
        signal: AbortSignal.timeout(Math.max(0, deadline - Date.now())),
      });
      if (reply.status === 404) return null;
      if (!reply.ok) throw new Error(`GET /api/threads/${asked.thread}: ${reply.status}`);
      return ((await reply.json()) as { changeSets: ChangeSet[] }).changeSets;
    });

  try {
    const first = await sets();
    if (first === null) return { code: exits.nothing, lines: ["no such thread"] };
    const waited = awaiting(first);
    if (waited.length === 0) return { code: exits.nothing, lines: ["nothing awaiting review"] };
    for (;;) {
      const left = deadline - Date.now();
      if (left <= 0) throw new TimedOut();
      const stop = AbortSignal.timeout(left);
      // From the newest entry on: the state read after connecting covers
      // whatever came before.
      const reply = await reach(() =>
        fetch(
          new URL(`/api/threads/${asked.thread}/events?after=${Number.MAX_SAFE_INTEGER}`, app),
          {
            signal: stop,
          },
        ),
      ).catch((error: unknown) => {
        throw stop.aborted ? new TimedOut() : error;
      });
      if (!reply.ok || !reply.body) {
        await reply.body?.cancel();
        const outcome = settle(waited, await sets());
        if (outcome) return outcome;
        await wait(retry);
        continue;
      }
      let outcome = settle(waited, await sets());
      if (outcome) {
        await reply.body.cancel();
        return outcome;
      }
      try {
        for await (const type of eventTypes(reply.body)) {
          // Another thread moving says nothing about this one.
          if (type === "threads") continue;
          outcome = settle(waited, await sets());
          if (outcome) return outcome;
        }
      } catch (error) {
        if (stop.aborted) throw new TimedOut();
        // The stream dropped; connect again.
        if (!(error instanceof TypeError)) throw error;
      }
      await reply.body.cancel().catch(() => {});
    }
  } catch (error) {
    if (error instanceof TimedOut || (error instanceof Error && error.name === "TimeoutError"))
      return { code: exits.timedOut, lines: ["timed out"] };
    if (error instanceof Gone) return { code: exits.serverGone, lines: ["server gone"] };
    throw error;
  }
}

// Each server-sent event's `type`, as the stream's `data:` lines carry it.
export async function* eventTypes(body: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffered = "";
  for await (const chunk of body) {
    buffered += decoder.decode(chunk, { stream: true });
    const events = buffered.split("\n\n");
    buffered = events.pop() ?? "";
    for (const event of events) yield* typesIn(event);
  }
}

export function* typesIn(event: string): Generator<string> {
  for (const line of event.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      const type: unknown = (JSON.parse(line.slice(5)) as { type?: unknown }).type;
      if (typeof type === "string") yield type;
    } catch {
      yield "unknown";
    }
  }
}
