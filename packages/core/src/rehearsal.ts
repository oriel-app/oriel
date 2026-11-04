// A release rehearsal (the release-rehearsal spike, draft decision): a
// workstream walked through as the situations its customers will meet, each
// with the items that bear on it and what nobody has answered. The agent
// derives it in a thread of its own and hands it to Oriel with
// `rehearsal.record()`; Oriel checks every ID and quote before it keeps it,
// draws each item from the index, and marks it stale when its evidence
// changes. Nothing here makes a model call, and nothing in it is a score.
//
// What an item says is one of four things, kept apart: documented intent,
// a claimed implementation, observed evidence, or a contradiction. A Done
// state is a claim; only words that report what someone saw the product do,
// in a test, a check or a real case, are observed evidence.
import type { Instant, ItemId } from "./ids.ts";
import { isItemId } from "./ids.ts";
import {
  array,
  type Infer,
  literal,
  nullable,
  object,
  refine,
  string,
  union,
  type Validator,
} from "./validate.ts";

export const evidenceKinds = ["intent", "claim", "observed", "contradiction"] as const;
export type EvidenceKind = (typeof evidenceKinds)[number];

export const maxSituations = 8;
export const maxEvidence = 12;
export const maxUnanswered = 6;
export const maxSituationChars = 140;
export const maxQuestionChars = 300;
export const maxEvidenceQuoteChars = 600;

const bounded = (max: number, what: string) =>
  refine(string, (text) => text.trim() !== "" && text.length <= max, `expected ${what}`);
const itemIdText = refine(string, isItemId, "expected an item ID");
const quote = nullable(
  bounded(maxEvidenceQuoteChars, `a quote of at most ${maxEvidenceQuoteChars} characters`),
);
const capped = <T>(item: Validator<T>, max: number, what: string) =>
  refine(array(item), (items) => items.length <= max, `expected at most ${max} ${what}`);

// One item's bearing on a situation, as the agent read it. `against`: for a
// contradiction, the item whose words or state it disagrees with, which
// may be the item itself.
export const evidence = object({
  id: itemIdText,
  says: union(literal("intent"), literal("claim"), literal("observed"), literal("contradiction")),
  quote,
  against: nullable(itemIdText),
});
export type Evidence = Omit<Infer<typeof evidence>, "id" | "against"> & {
  id: ItemId;
  against: ItemId | null;
};

// A question no item settles; `id`, where one item asks it, with its words.
export const unanswered = object({
  question: bounded(maxQuestionChars, `a question of at most ${maxQuestionChars} characters`),
  id: nullable(itemIdText),
  quote,
});
export type Unanswered = Omit<Infer<typeof unanswered>, "id"> & { id: ItemId | null };

export const situation = object({
  title: bounded(maxSituationChars, `a title of at most ${maxSituationChars} characters`),
  evidence: capped(evidence, maxEvidence, "items a situation"),
  unanswered: capped(unanswered, maxUnanswered, "questions a situation"),
});
export type Situation = { title: string; evidence: Evidence[]; unanswered: Unanswered[] };

// What `rehearsal.record()` takes: the situations, in the order a customer
// meets them.
export const rehearsalBody = refine(
  array(situation),
  (situations) => situations.length > 0 && situations.length <= maxSituations,
  `expected 1 to ${maxSituations} situations`,
) as Validator<unknown> as Validator<Situation[]>;

// What an item was when the rehearsal was kept: its update time in the
// index, or null when the index didn't have it.
export type Seen = { id: ItemId; updatedAt: Instant | null };

// A rehearsal as Oriel keeps it: the agent's situations, checked, the
// workstream version and the items it read, and when.
export type Rehearsal = {
  id: string;
  threadId: string;
  regionVersion: number;
  situations: Situation[];
  seen: Seen[];
  at: Instant;
};

export const storedSeen: Validator<Seen[]> = array(
  object({ id: itemIdText, updatedAt: nullable(string) }),
) as Validator<unknown> as Validator<Seen[]>;

// Why a kept rehearsal may no longer say what its items say now: computed
// from the index and the workstream, never by a model.
export type Stale =
  | { kind: "changed"; ids: ItemId[] }
  | { kind: "gone"; ids: ItemId[] }
  | { kind: "added"; ids: ItemId[] }
  | { kind: "removed"; ids: ItemId[] };

export function staleness(
  kept: Pick<Rehearsal, "seen">,
  now: { members: readonly ItemId[]; updatedAt: (id: ItemId) => Instant | null },
): Stale[] {
  const was = new Map(kept.seen.map((seen) => [seen.id, seen.updatedAt]));
  const members = new Set(now.members);
  const changed: ItemId[] = [];
  const gone: ItemId[] = [];
  for (const [id, at] of was) {
    if (!members.has(id)) continue;
    const current = now.updatedAt(id);
    if (current === null && at !== null) gone.push(id);
    else if (current !== at) changed.push(id);
  }
  const added = now.members.filter((id) => !was.has(id));
  const removed = [...was.keys()].filter((id) => !members.has(id));
  const found: Stale[] = [];
  if (changed.length) found.push({ kind: "changed", ids: changed });
  if (gone.length) found.push({ kind: "gone", ids: gone });
  if (added.length) found.push({ kind: "added", ids: added });
  if (removed.length) found.push({ kind: "removed", ids: removed });
  return found;
}

// A rehearsal thread's title, Oriel's, so no model titles its fixed ask.
export const rehearsalTitle = "Release rehearsal";

// What the person's click on Rehearse the release says in the thread:
// Oriel's fixed words, with no source content, so the region's items reach
// the agent only as run results (SPEC §5).
export const rehearsalAsk = `Rehearse this workstream's release, as its customers will meet it.

1. Read every item in this workstream first: each one's whole text, and its state.
2. Walk the release as 3 to 6 situations a customer meets, in the order they meet them. Title each in the customer's words, as what happens to them.
3. For each situation, list the items that bear on it, each with what it says:
   - intent: it says what should happen;
   - claim: it says the work is built, shipped or done (a Done state is a claim, never observed);
   - observed: it reports what someone saw the product do, in a test, a check or a real case such as a retro or a support call, and what it showed;
   - contradiction: it disagrees with another item, or with its own state. Name that item as against.
   Quote each item's own words where you can. What was observed, or a contradiction, must quote the words that show it.
4. For each situation, list what nobody has answered: what a customer, support or the team will need to know that no item settles. Where an item asks it, name the item and quote it.
5. Hand it to Oriel with rehearsal.record(), then answer in two or three sentences. Oriel shows the rehearsal on the workstream's page, so don't repeat it, and give no score or percentage.`;

// What Prepare follow-up work says, for the situation the person picked,
// numbered from 1.
export const followUpAsk = (n: number) =>
  `Prepare follow-up work for situation ${n} of this rehearsal. Read it with rehearsal.read(), then propose one change set: acceptance criteria on the existing story each open question or contradiction belongs to, and a new story only for work no story covers. Change no item's state, and don't call anything done or observed working.`;
