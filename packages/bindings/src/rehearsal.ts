// `rehearsal`, in a rehearsal thread's module only (the release-rehearsal
// spike): the agent hands Oriel the situations it derived, and reads back
// what Oriel kept. Oriel checks every ID and quote before it keeps one, and
// refuses with what to change, as a tool result, rather than failing the
// run. What it reads back is the agent's own words and the sources', so it
// reaches the agent only as a run's result.
import { param, read, unknown } from "@oriel/core";
import type { Fn, Host } from "./fn.ts";

const record: Fn = {
  space: "rehearsal",
  outsideRegion: false,
  ...read({
    name: "record",
    doc: "Hands Oriel this release rehearsal: 1 to 8 situations, each with at most 12 items and 6 questions. It replaces any earlier one; Oriel checks each ID and quote, and says what it kept or what to change.",
    params: [param("situations", "Situation[]", unknown)],
    returns: "string",
    run: async ([situations], host: Host) => host.rehearse(situations),
  }),
};

const kept: Fn = {
  space: "rehearsal",
  outsideRegion: false,
  ...read({
    name: "read",
    doc: "The rehearsal Oriel keeps for this thread, its situations numbered from 1, or null.",
    params: [],
    returns: "{ n: number; situation: Situation }[] | null",
    run: async (_, host: Host) => host.rehearsed(),
  }),
};

export const rehearsalFns: readonly Fn[] = [record, kept];

// Fixed text.
export const rehearsalTypes = [
  "/** What an item says of a situation. `against`: for a contradiction, the item it disagrees with. `quote`: the item's own words, checked by Oriel. */",
  'type Evidence = { id: string; says: "intent" | "claim" | "observed" | "contradiction"; quote: string | null; against: string | null };',
  "/** `id` and `quote`: where an item asks the question, if one does. */",
  "type Unanswered = { question: string; id: string | null; quote: string | null };",
  "type Situation = { title: string; evidence: Evidence[]; unanswered: Unanswered[] };",
];
