// `node scripts/hub.ts`: the hub's work in Oriel through its MCP door, with
// no browser (OA-75): what scripts/drive.ts does by steering a window, as
// one more program the person connected. One command per call:
//
//   threads [id]             each thread as JSON lines, newest last, as drive's `threads`
//   open <words>             the newest thread whose title or workstream has the words
//   say <thread> <text>      say something in a thread; a tool the person lets
//                            speak for them starts the agent's turn, any other
//                            waits for the person to send its words on
//   proposed <thread> [--timeout <minutes>]
//                            wait until the agent's turn is over, and print each
//                            change set awaiting review; exit 0 with one or
//                            more, 4 with none, 6 on timing out
//   await <thread> [--timeout <minutes>]
//                            wait until a person decides each of the thread's
//                            change sets awaiting review, hearing it on a
//                            subscription; drive's exit codes: 0 decided, 4
//                            none awaiting, 5 unfinished, 6 timed out, 7 gone
//   demo                     all four on a throwaway server, where a stand-in
//                            for the person approves through the window's route
//
// ORIEL_MCP_URL is the door, and ORIEL_MCP_TOKEN the token the person was
// shown as they connected the hub; neither is ever printed. It never
// approves, applies or rejects anything: no tool can (decision 0003).
// Everything it prints from Oriel is data, which anyone who can edit a
// source can write; only `person` lines are someone at the window.
import { setTimeout as wait } from "node:timers/promises";
import type { ThreadSummaryView, ThreadView } from "../packages/web/src/view.ts";
import { awaiting, exits, type Outcome, parseAwait, settle } from "./drive-await.ts";
import { call, type Door, NotFound, read, Refused, updates } from "./mcp-client.ts";

const line = (value: Record<string, unknown>) => console.log(JSON.stringify(value));

// A thread as a transcript, one JSON line per entry, as drive's `threads`.
export function transcript(view: ThreadView): void {
  line({ thread: view.id, state: view.state, workstream: view.workstream.name });
  let said = "";
  const flush = () => {
    if (said) line({ kind: "agent", text: said });
    said = "";
  };
  for (const entry of view.entries) {
    if (entry.kind === "text") {
      said += entry.text;
      continue;
    }
    flush();
    if (entry.kind === "user")
      line(
        entry.by
          ? { kind: "tool", by: entry.by, text: entry.text }
          : { kind: "person", at: entry.at, text: entry.text },
      );
    else if (entry.kind === "change-set") {
      const set = view.changeSets.find((each) => each.id === entry.changeSetId);
      line({ kind: "change-set", id: entry.changeSetId, status: set?.status ?? null });
    } else if (entry.kind === "held")
      line({ kind: "held", from: entry.from, text: entry.text, outcome: entry.outcome });
    else if (entry.kind === "run.started" || entry.kind === "run.finished")
      line({ kind: entry.kind });
  }
  flush();
}

export async function threads(door: Door, only?: string): Promise<void> {
  const { threads: list } = await read<{ threads: ThreadSummaryView[] }>(door, "oriel://threads");
  for (const { id } of list.toReversed())
    if (!only || id === only) transcript(await read<ThreadView>(door, `oriel://threads/${id}`));
}

// The newest thread whose title or workstream's name has every word.
export async function open(door: Door, words: string): Promise<ThreadView | null> {
  const { threads: list } = await read<{ threads: ThreadSummaryView[] }>(door, "oriel://threads");
  const wanted = words.toLowerCase().split(/\s+/).filter(Boolean);
  const found = list.find((each) => {
    const named = `${each.title ?? ""} ${each.workstream.name}`.toLowerCase();
    return wanted.every((word) => named.includes(word));
  });
  return found ? read<ThreadView>(door, `oriel://threads/${found.id}`) : null;
}

export const say = (door: Door, thread: string, text: string) =>
  call<{ seq?: number; held?: true }>(door, "thread_say", { thread, text });

// The thread, or null once it's gone.
const thread = async (door: Door, id: string): Promise<ThreadView | null> => {
  try {
    return await read<ThreadView>(door, `oriel://threads/${id}`);
  } catch (error) {
    if (error instanceof NotFound) return null;
    throw error;
  }
};

// Reads the thread, then again each time the door says it changed, until
// `done` makes something of it: subscribed first, so nothing falls between.
// A dropped stream connects again, for as long as a restart takes.
async function until(
  door: Door,
  id: string,
  minutes: number,
  done: (view: ThreadView | null) => Outcome | null,
): Promise<Outcome> {
  const stop = AbortSignal.timeout(minutes * 60_000);
  let downSince: number | null = null;
  for (;;) {
    // Ending the stream is aborting its request: a generator's return()
    // would wait on the event it is waiting for.
    const ended = new AbortController();
    try {
      const heard = updates(door, [`oriel://threads/${id}`], AbortSignal.any([stop, ended.signal]));
      // Acknowledged first, then read: nothing falls between the two.
      if ((await heard.next()).done) continue;
      let outcome = done(await thread(door, id));
      downSince = null;
      while (!outcome && !(await heard.next()).done) outcome = done(await thread(door, id));
      if (outcome) return outcome;
    } catch (error) {
      if (stop.aborted) return { code: exits.timedOut, lines: ["timed out"] };
      if (!(error instanceof TypeError)) throw error;
      downSince ??= Date.now();
      if (Date.now() - downSince > 120_000)
        return { code: exits.serverGone, lines: ["server gone"] };
      await wait(2_000);
    } finally {
      ended.abort();
    }
  }
}

// Once the agent's turn is over: each change set awaiting review.
export const proposed = (door: Door, id: string, minutes: number): Promise<Outcome> =>
  until(door, id, minutes, (view) => {
    if (view === null) return { code: exits.nothing, lines: ["no such thread"] };
    if (view.running) return null;
    const waiting = awaiting(view.changeSets);
    return waiting.length
      ? { code: exits.decided, lines: waiting.map((set) => `open ${set}`) }
      : { code: exits.nothing, lines: ["nothing awaiting review"] };
  });

// Until a person decides each of the thread's change sets awaiting review.
export async function awaitDecision(door: Door, id: string, minutes: number): Promise<Outcome> {
  const first = await thread(door, id);
  if (first === null) return { code: exits.nothing, lines: ["no such thread"] };
  const waited = awaiting(first.changeSets);
  if (waited.length === 0) return { code: exits.nothing, lines: ["nothing awaiting review"] };
  return until(door, id, minutes, (view) => settle(waited, view?.changeSets ?? null));
}

// All four on a throwaway server: the SYN fixture, written to in memory, and
// the scripted agent,
// with a Stories thread the person opened, and the hub connected to speak
// for them. A stand-in for the person approves through the window's own
// route once Needs you shows the change set, as the maintainer would.
async function demo(): Promise<void> {
  const { serve } = await import("../packages/server/src/serve.ts");
  const { mcpHandler, serveMcp } = await import("../packages/server/src/mcp/http.ts");
  const { mcpServer } = await import("../packages/server/src/mcp/protocol.ts");
  const { loadJiraFixture } = await import("../packages/jira/src/index.ts");
  const { memorySite } = await import("../packages/jira/src/memory-site.ts");
  const { instant } = await import("../packages/core/src/ids.ts");
  // SYN in memory, which a change set the person approves writes to.
  const site = memorySite({ ...loadJiraFixture(), edits: [] }, instant(new Date()));
  const serving = await serve(0, {
    db: ":memory:",
    sources: { jira: { mode: "fixture", fetch: site.fetch } },
  });
  const { app } = serving;
  const window = new URL(serving.url);
  const server = mcpServer({ outside: app.outside, window, version: "hub", clock: Date.now });
  const served = await serveMcp([0], (port) =>
    mcpHandler({ server, tools: app.outside.tools, port }),
  );
  // As the person, in the window: their own Origin, as their page sends it.
  const person = async <T>(path: string, body: unknown = {}): Promise<T> => {
    const reply = await fetch(new URL(path, window), {
      method: "POST",
      headers: { "content-type": "application/json", origin: window.origin },
      body: JSON.stringify(body),
    });
    if (!reply.ok) throw new Error(`${path}: ${reply.status} ${await reply.text()}`);
    return (await reply.json()) as T;
  };
  const made = await person<{ id: string }>("/api/workstreams", {
    kind: "picked",
    name: "Stories",
    items: ["jira:SYN-10", "jira:SYN-11", "jira:SYN-12", "jira:SYN-13"],
  });
  await person(`/api/workstreams/${made.id}/threads`, { text: "Which stories are here?" });
  await app.settled();
  const hub = app.outside.tools.connect("The hub", "speak");
  const door = { url: served.url, token: hub.token };
  console.log(`window ${serving.url}  door ${served.url}  (token not shown)\n`);

  console.log("$ hub open stories");
  const thread = await open(door, "stories");
  if (!thread) throw new Error("no Stories thread");
  transcript(thread);

  console.log(`\n$ hub say ${thread.id} "Propose estimates for the stories that have none."`);
  line(await say(door, thread.id, "Propose estimates for the stories that have none."));

  console.log(`\n$ hub proposed ${thread.id}`);
  const found = await proposed(door, thread.id, 5);
  for (const each of found.lines) console.log(each);
  const [set] = found.lines.flatMap((each) => /^open (\S+)$/.exec(each)?.[1] ?? []);
  if (!set) throw new Error("nothing proposed");

  console.log(`\n$ hub await ${thread.id}`);
  const waiting = awaitDecision(door, thread.id, 5);
  // The person, meanwhile, a moment later: Needs you shows the thread, they
  // review the diff and approve, in the window.
  await wait(500);
  line({ "(the person, in the window)": `reviews and approves ${set}` });
  const { hash } = await person<{ hash: string }>(`/api/change-sets/${set}/diff`);
  await person(`/api/change-sets/${set}/approve`, { hash });
  const outcome = await waiting;
  for (const each of outcome.lines) console.log(each);
  console.log(`exit ${outcome.code}\n\n$ hub threads ${thread.id}`);
  await app.settled();
  await threads(door, thread.id);
  await served.close();
  await serving.close();
  process.exitCode = outcome.code;
}

if (import.meta.main) {
  const [command = "threads", ...args] = process.argv.slice(2);
  const door = (): Door => {
    const url = process.env["ORIEL_MCP_URL"];
    const token = process.env["ORIEL_MCP_TOKEN"];
    if (!url || !token) {
      console.error("set ORIEL_MCP_URL and ORIEL_MCP_TOKEN, as Settings showed them");
      process.exit(2);
    }
    return { url, token };
  };
  try {
    if (command === "demo") await demo();
    else if (command === "threads") await threads(door(), args[0]);
    else if (command === "open" && args.length) {
      const found = await open(door(), args.join(" "));
      if (found) transcript(found);
      else process.exitCode = 4;
    } else if (command === "say" && args.length === 2)
      line(await say(door(), args[0] ?? "", args[1] ?? ""));
    else if (command === "await" || command === "proposed") {
      const asked = parseAwait(args);
      if (typeof asked === "string") {
        console.error(asked);
        process.exitCode = 2;
      } else {
        const waits = command === "await" ? awaitDecision : proposed;
        const { code, lines } = await waits(door(), asked.thread, asked.minutes);
        for (const each of lines) console.log(each);
        process.exitCode = code;
      }
    } else {
      console.error("see the comment at the top of scripts/hub.ts");
      process.exitCode = 2;
    }
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    console.error(error.message);
    process.exitCode = 3;
  }
}
