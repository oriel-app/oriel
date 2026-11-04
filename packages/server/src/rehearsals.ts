// Release rehearsals (the release-rehearsal spike, draft decision): Oriel's
// side of a rehearsal thread. Its module's `rehearsal.record()` hands Oriel
// the agent's situations; Oriel keeps them only once every ID is one the run
// could reach and every quote is in its item word for word, and what was
// observed, or a contradiction, shows its words. The page's view is computed from what was
// kept, the index and the thread, with no model call.
import {
  followUpAsk,
  type Instant,
  type ItemId,
  maxSituations,
  type Reader,
  type Region,
  type Rehearsal,
  rehearsalBody,
  type Situation,
  staleness,
  type Ulid,
} from "@oriel/core";
import type { Message, RehearsalStore } from "@oriel/db";
import type { Chips, RehearsalView } from "@oriel/web/view";
import { wordForWord } from "./quotes.ts";

export type Checked = { ok: true; situations: Situation[] } | { ok: false; why: string };

const refused = (why: string): Checked => ({ ok: false, why });

// The agent's situations as Oriel will keep them, or why not.
export async function checkRehearsal(
  input: unknown,
  reaches: (id: string) => boolean,
  read: Reader["read"],
): Promise<Checked> {
  const shaped = rehearsalBody(input);
  if (!shaped.ok)
    return refused(
      `${shaped.issues
        .slice(0, 5)
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("; ")}. Pass 1 to ${maxSituations} situations, each a Situation as declared.`,
    );
  const situations = shaped.value;
  const problems: string[] = [];
  const named = new Set<ItemId>();
  situations.forEach((situation, s) => {
    const at = `situation ${s + 1}`;
    for (const each of situation.evidence) {
      named.add(each.id);
      if (each.against) named.add(each.against);
      if ((each.says === "observed" || each.says === "contradiction") && each.quote === null)
        problems.push(`${at}: ${each.id} is ${each.says} with no quote; quote its words`);
      if (each.says === "contradiction" && each.against === null)
        problems.push(`${at}: name what ${each.id} contradicts as against`);
      if (each.says !== "contradiction" && each.against !== null)
        problems.push(`${at}: only a contradiction names against`);
    }
    for (const question of situation.unanswered) {
      if (question.id) named.add(question.id);
      if (question.quote !== null && question.id === null)
        problems.push(`${at}: a question's quote needs the id of the item it is from`);
    }
  });
  const unreachable = [...named].filter((id) => !reaches(id));
  if (unreachable.length)
    problems.push(
      `${unreachable.join(", ")} ${unreachable.length === 1 ? "isn't" : "aren't"} in this region or found by this run's search()`,
    );
  if (problems.length) return refused(`${problems.join(". ")}.`);
  const texts = new Map<string, string>();
  for (const result of named.size ? await read([...named]) : [])
    if (result.status === "ok")
      texts.set(result.id, `${result.content.title}\n${result.content.text}`);
  const quotes = situations.flatMap((situation, s) => [
    ...situation.evidence.map((each) => ({ s, id: each.id, quote: each.quote })),
    ...situation.unanswered.map((each) => ({ s, id: each.id, quote: each.quote })),
  ]);
  const misquoted = quotes.filter(
    ({ id, quote }) => quote !== null && id !== null && !wordForWord(quote, texts.get(id) ?? ""),
  );
  if (misquoted.length)
    return refused(
      `${misquoted
        .map(({ s, id }) => `situation ${s + 1}: the quote from ${id} isn't in it word for word`)
        .join("; ")}. Copy each quote from the item's text, or leave it null.`,
    );
  return { ok: true, situations };
}

// What the agent reads after Oriel keeps a rehearsal.
const keptText = (situations: readonly Situation[]) => {
  const items = new Set(situations.flatMap((s) => s.evidence.map((e) => e.id))).size;
  const questions = situations.reduce((sum, s) => sum + s.unanswered.length, 0);
  return `Oriel keeps this rehearsal: ${situations.length} situations, ${items} items, ${questions} open questions. It shows it on the workstream's page, each item with its state from its source, so don't repeat it in your answer.`;
};

// A rehearsal thread's `rehearsal` namespace, for one run.
export function rehearsalHost(deps: {
  store: RehearsalStore;
  thread: Ulid;
  region: Region;
  reader: Reader;
  // Each item's update time in the index now, or null.
  updatedAt: (id: ItemId) => Instant | null;
  newId: () => Ulid;
  now: () => Instant;
}): {
  record(input: unknown, reaches: (id: string) => boolean): Promise<string>;
  read(): Promise<unknown>;
} {
  return {
    async record(input, reaches) {
      const checked = await checkRehearsal(input, reaches, (ids) => deps.reader.read(ids));
      if (!checked.ok) return `Oriel kept nothing: ${checked.why}`;
      const seen = deps.region.items.map(({ id }) => ({ id, updatedAt: deps.updatedAt(id) }));
      deps.store.record(
        deps.thread,
        {
          id: deps.newId(),
          regionVersion: deps.region.version,
          situations: checked.situations,
          seen,
        },
        deps.now(),
      );
      return keptText(checked.situations);
    },
    async read() {
      const kept = deps.store.of(deps.thread);
      return kept && kept.situations.map((situation, i) => ({ n: i + 1, situation }));
    },
  };
}

// For each situation the person asked follow-up work for, the change sets
// the thread proposed after they asked, until they asked about another.
export function followUps(messages: readonly Message[], count: number): RehearsalView["followUps"] {
  const asks = new Map(Array.from({ length: count }, (_, i) => [followUpAsk(i + 1), i + 1]));
  const found = new Map<number, string[]>();
  let current: number | null = null;
  for (const message of messages) {
    if (message.role === "user") {
      current = asks.get(message.text) ?? null;
      if (current !== null && !found.has(current)) found.set(current, []);
    }
    if (message.role !== "agent" || current === null) continue;
    const event = message.event as { kind?: unknown; changeSetId?: unknown };
    if (event.kind === "change-set" && typeof event.changeSetId === "string")
      found.get(current)?.push(event.changeSetId);
  }
  return [...found].map(([situation, changeSets]) => ({ situation, changeSets }));
}

// The workstream's newest rehearsal as its page shows it, or null when none
// was started.
export async function rehearsalView(deps: {
  store: RehearsalStore;
  workstream: Ulid;
  members: readonly ItemId[];
  updatedAt: (id: ItemId) => Instant | null;
  messages: (thread: Ulid) => Message[];
  running: (thread: Ulid) => boolean;
  chips: (ids: readonly string[], thread: Ulid) => Promise<Chips>;
}): Promise<RehearsalView | null> {
  const newest = deps.store.newest(deps.workstream);
  if (!newest) return null;
  const { thread, rehearsal } = newest;
  const ups = rehearsal ? followUps(deps.messages(thread), rehearsal.situations.length) : [];
  const ids = new Set<string>([thread, ...ups.flatMap((up) => up.changeSets)]);
  for (const situation of rehearsal?.situations ?? []) {
    for (const each of situation.evidence) {
      ids.add(each.id);
      if (each.against) ids.add(each.against);
    }
    for (const question of situation.unanswered) if (question.id) ids.add(question.id);
  }
  return {
    thread: { id: thread, running: deps.running(thread) },
    rehearsal: rehearsal && shown(rehearsal, deps),
    followUps: ups,
    chips: await deps.chips([...ids], thread),
  };
}

const shown = (
  rehearsal: Rehearsal,
  now: { members: readonly ItemId[]; updatedAt: (id: ItemId) => Instant | null },
): NonNullable<RehearsalView["rehearsal"]> => ({
  at: rehearsal.at,
  situations: rehearsal.situations,
  stale: staleness(rehearsal, now),
});

// Each item's update time, as these index records have it, or null.
export function updatedAtOf(
  records: readonly { id: ItemId; updatedAt: Instant }[],
): (id: ItemId) => Instant | null {
  const at = new Map<string, Instant>(records.map((record) => [record.id, record.updatedAt]));
  return (id) => at.get(id) ?? null;
}
