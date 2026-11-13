// It reads state only, never approving, applying or rejecting, and prints change-set IDs and
// statuses, never synced content.
import { setTimeout as wait } from "node:timers/promises";

export const exits = { decided: 0, nothing: 4, unfinished: 5, timedOut: 6, serverGone: 7 };

type ChangeSet = { id: string; status: string };
export type Outcome = { code: number; lines: string[] };

export const awaiting = (sets: readonly ChangeSet[]): string[] =>
  sets.filter((set) => set.status === "open").map((set) => set.id);

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

const retry = 2_000;
const goneFor = 120_000;

class Gone extends Error {}
class TimedOut extends Error {}

export async function awaitDecision(app: string, asked: Asked): Promise<Outcome> {
  const deadline = Date.now() + asked.minutes * 60_000;
  let downSince: number | null = null;
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
          if (type === "threads") continue;
          outcome = settle(waited, await sets());
          if (outcome) return outcome;
        }
      } catch (error) {
        if (stop.aborted) throw new TimedOut();
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
