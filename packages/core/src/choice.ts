// A choice (the decision-desk spike): a question the workstream's sources
// discuss and haven't settled, with the options on the table, the evidence
// for each, and what nobody has answered. The agent finds it, in a run
// Oriel starts for that, and hands Oriel its reading with `choice()`: each
// option's standing, and each piece of evidence as an item and a quote from
// it. That reading is the agent's, and shows as the agent's. Oriel checks
// every quote word for word against its item, refusing what isn't there,
// and dates it from the source's own view of the item: who said it and
// when, as the source records it. Those are Oriel's, and show as Oriel's.
// What the person does with a choice (choose an option, defer it, ask for
// clarification) is theirs alone; the agent never settles one.
import { type Instant, isInstant, isItemId, isUlid, type ItemId, type Ulid } from "./ids.ts";
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

// Where an option stands, as the agent reads the evidence: someone put it
// forward; those who decide it said yes to exactly it; or a later agreed
// change replaced it.
export const standings = ["proposed", "agreed", "superseded"] as const;
export type Standing = (typeof standings)[number];

// What a piece of evidence does for its option, as the agent reads it.
export const evidenceRoles = ["proposes", "agrees", "objects", "amends", "asks"] as const;
export type EvidenceRole = (typeof evidenceRoles)[number];

export const maxChoicesPerTurn = 3;
export const maxOptions = 5;
export const maxEvidence = 6;
export const maxOpen = 5;
export const maxQuestionChars = 200;
export const maxLabelChars = 160;
export const maxChoiceQuoteChars = 500;

const words = (max: number, what: string) =>
  refine(
    string,
    (text) => text.trim() !== "" && [...text].length <= max && !/[\r\n]/.test(text),
    `expected ${what}: one line of 1 to ${max} characters`,
  );
const between = <T>(item: Validator<T>, min: number, max: number, what: string) =>
  refine(
    array(item),
    (list) => list.length >= min && list.length <= max,
    `expected ${min} to ${max} ${what}`,
  );
const oneOf = <const T extends readonly string[]>(values: T, what: string) =>
  refine(
    string,
    (value): value is T[number] => (values as readonly string[]).includes(value),
    `expected ${what}: ${values.join(", ")}`,
  );

// What the agent hands `choice()`, as Oriel checks its shape. Every string
// in it is the agent's words but each quote, which must be its item's.
export const choiceAsk = object({
  question: words(maxQuestionChars, "the question"),
  options: between(
    object({
      label: words(maxLabelChars, "the option"),
      standing: oneOf(standings, "a standing"),
      evidence: between(
        object({
          id: refine(string, isItemId, "expected an item ID from this region"),
          quote: refine(
            string,
            (text) => text.trim() !== "" && text.length <= maxChoiceQuoteChars,
            `expected the item's own words, 1 to ${maxChoiceQuoteChars} characters`,
          ),
          role: oneOf(evidenceRoles, "a role"),
        }),
        1,
        maxEvidence,
        "pieces of evidence",
      ),
    }),
    1,
    maxOptions,
    "options",
  ),
  open: between(words(maxQuestionChars, "an unanswered question"), 0, maxOpen, "open questions"),
});
export type ChoiceAsk = Infer<typeof choiceAsk>;

// What a refused call is told about the shape, beside the issues.
export const choiceHelp = `choice() takes { question, options: [{ label, standing, evidence: [{ id, quote, role }] }], open }: 1 to ${maxOptions} options, each with 1 to ${maxEvidence} quotes copied exactly from an item in this region, and up to ${maxOpen} open questions.`;

// One piece of evidence as Oriel checked it. `id`, `quote` and `role` are
// as the agent gave them, the quote found word for word in the item. The
// rest is Oriel's, from the source's view of the item: `author` and `at`,
// the message the quote is in, as its source records it (null when it is
// in the item's body, which has no one date); `place`, where in the item
// it is ("message", or the body's heading, such as "Description"); and
// `asOf`, when the item last changed, as the index had it then, which
// tells whether it has changed since.
export type Evidence = {
  id: ItemId;
  quote: string;
  role: EvidenceRole;
  author: string | null;
  at: Instant | null;
  place: string;
  asOf: Instant;
};

export type ChoiceOption = { label: string; standing: Standing; evidence: Evidence[] };

// A choice as Oriel checked it, stored with its turn, as a block is.
export type Choice = {
  id: Ulid;
  question: string;
  options: ChoiceOption[];
  open: string[];
  checkedAt: Instant;
};

const instantValue = refine(string, isInstant, "expected an instant");
const evidence: Validator<Evidence> = object({
  id: refine(string, isItemId, "expected an item ID"),
  quote: string,
  role: oneOf(evidenceRoles, "a role"),
  author: nullable(string),
  at: nullable(instantValue),
  place: string,
  asOf: instantValue,
});
export const storedChoice: Validator<Choice> = object({
  id: refine(string, isUlid, "expected a ULID"),
  question: string,
  options: array(
    object({ label: string, standing: oneOf(standings, "a standing"), evidence: array(evidence) }),
  ),
  open: array(string),
  checkedAt: instantValue,
});

// What the person did with a choice, which Oriel records as its own line in
// the thread: chose an option (by its place, from 0), deferred it, asked
// for clarification, or reopened it after any of those.
export const choiceOutcomes = ["chosen", "deferred", "asked", "reopened"] as const;
export type ChoiceOutcome = (typeof choiceOutcomes)[number];
export const choiceOutcome: Validator<ChoiceOutcome> = union(
  literal("chosen"),
  literal("deferred"),
  literal("asked"),
  literal("reopened"),
);

// The fixed words a choice's controls say in the thread for the person, so
// no title, label or quote, which synced text may have steered, is ever the
// person's message (decision 0030's questions to start from). The choice
// and the option reach the agent by ID, in Oriel's note before it.
export const choiceWords = {
  find: "What's still undecided here?",
  chosen:
    "Carry my choice into the work: propose the changes to the items, and a reply in the conversation saying what was decided.",
  asked:
    "Draft a reply in the conversation that asks what's still unanswered, for me to review before it's sent.",
} as const;

// Each item a choice cites, once, in the order it first cites it.
export const choiceItems = (choice: Pick<Choice, "options">): ItemId[] => [
  ...new Set(choice.options.flatMap((option) => option.evidence.map((e) => e.id))),
];
