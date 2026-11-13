// A second look never approves and never blocks: the person decides, in Oriel's own controls.
// It's stored with the hash it read, so it can't silently stand for a diff it never read.
import { type Instant, isItemId, type ItemId, type Ulid } from "./ids.ts";
import type { CapturedMutation } from "./sandbox.ts";
import {
  array,
  boolean,
  type Infer,
  literal,
  number,
  object,
  optional,
  refine,
  string,
  union,
  type Validator,
} from "./validate.ts";

export const findingKinds = ["conflict", "discussion", "companion", "related"] as const;
export type FindingKind = (typeof findingKinds)[number];

export const maxFindings = 8;
export const maxFindingQuotes = 4;
export const maxSaysChars = 320;
export const maxEvidenceQuoteChars = 600;

// Words that grade the change or tell the person to approve are refused: steered text would want a second look to say them.
const verdict =
  /\b(?:safe|harmless|risk-?free|lgtm|good to go|nothing to worry)\b|\b(?:looks?|seems?) (?:good|fine|ok(?:ay)?|right|correct)\b|\b(?:no|without) (?:issues?|problems?|concerns?|risks?)\b|\b(?:should|can|could|may|ok to|okay to|fine to|safe to) (?:be )?approved?\b|\bapprove (?:it|this|the change)\b/iu;

export const verdictIn = (text: string): string | null => verdict.exec(text)?.[0] ?? null;

const text = (max: number, what: string) =>
  refine(string, (value) => value.trim() !== "" && value.length <= max, `expected ${what}`);
const lineNumber = refine(
  number,
  (n) => Number.isInteger(n) && n >= 1,
  "expected a line number from 1",
);

const quote = text(maxEvidenceQuoteChars, `a quote of at most ${maxEvidenceQuoteChars} characters`);
const evidenceAsk = union(
  object({ id: refine(string, isItemId, "expected an item's ID, such as jira:SYN-12"), quote }),
  object({ line: lineNumber, quote }),
);
const findingAsk = object({
  kind: union(literal("conflict"), literal("discussion"), literal("companion"), literal("related")),
  lines: refine(array(lineNumber), (lines) => lines.length > 0, "expected at least one line"),
  says: text(maxSaysChars, `one or two sentences, at most ${maxSaysChars} characters`),
  evidence: refine(
    array(evidenceAsk),
    (evidence) => evidence.length > 0 && evidence.length <= maxFindingQuotes,
    `expected 1 to ${maxFindingQuotes} quotes`,
  ),
  changes: optional(array(lineNumber)),
});
export const challengeAsk = refine(
  array(findingAsk),
  (findings) => findings.length <= maxFindings,
  `expected at most ${maxFindings} findings`,
);
export type ChallengeAsk = Infer<typeof challengeAsk>;
export type FindingAsk = ChallengeAsk[number];

// Fixed words, with no ID, title or text: the diff and everything the agent reads come back as tool results.
export const challengeAskText = `Oriel asks you for a second look at the change set this thread proposed, before the person decides on it. You don't decide whether it should be approved, and you can't change it.

Read it with challenge.diff(). Then find what it would make wrong elsewhere: discussions it affects, decisions or policy it disagrees with (a later reply may have changed an earlier decision: check who said what, and when), items worth a look, and changes that may need to go with it. Search outside the workstream where it helps.

Hand Oriel only what the items' own words show, once, with challenge.record(). A write in that same run is only a suggestion the person may add. If you find nothing, record an empty list. Your reply isn't shown.`;

export type Finding = {
  kind: FindingKind;
  lines: number[];
  says: string;
  evidence: Evidence[];
  changes: number[];
};

export type Evidence =
  | { id: ItemId; line: null; quote: string; outside: boolean }
  | { id: null; line: number; quote: string; outside: false };

export const evidenceItems = (finding: Pick<Finding, "evidence">): ItemId[] =>
  finding.evidence.flatMap((e) => (e.id === null ? [] : [e.id]));

// From its runs' own records, not its words.
export type Coverage = { read: ItemId[]; of: number; searches: number };

export type Basis = { id: ItemId; updatedAt: Instant | null };

export type ChallengeState = "running" | "ready" | "failed";

export type Challenge = {
  id: Ulid;
  workspaceId: Ulid;
  changeSetId: Ulid;
  threadId: Ulid;
  hash: string;
  state: ChallengeState;
  findings: Finding[];
  companions: CapturedMutation[];
  added: number[];
  coverage: Coverage | null;
  basis: Basis[];
  error: string | null;
  model: string | null;
  usage: { inputTokens: number; outputTokens: number };
  startedAt: Instant;
  finishedAt: Instant | null;
  dismissedAt: Instant | null;
};

export type Staleness = { diff: boolean; items: ItemId[] };

export function staleness(
  challenge: Pick<Challenge, "hash" | "basis">,
  now: { hash: string; updatedAt: (id: ItemId) => Instant | null },
): Staleness {
  return {
    diff: now.hash !== challenge.hash,
    items: challenge.basis.flatMap((basis) =>
      now.updatedAt(basis.id) === basis.updatedAt ? [] : [basis.id],
    ),
  };
}

export const isStale = (stale: Staleness): boolean => stale.diff || stale.items.length > 0;

const storedEvidence: Validator<Evidence> = union(
  object({
    id: refine(string, isItemId, "expected an item ID"),
    line: literal(null),
    quote: string,
    outside: boolean,
  }),
  object({ id: literal(null), line: number, quote: string, outside: literal(false) }),
);
export const storedFinding: Validator<Finding> = object({
  kind: union(literal("conflict"), literal("discussion"), literal("companion"), literal("related")),
  lines: array(number),
  says: string,
  evidence: array(storedEvidence),
  changes: array(number),
});

export type ChallengeHost = {
  diff(): Promise<unknown>;
  record(runId: Ulid, findings: unknown): Promise<string>;
};
export type ChallengeRun = { diff(): Promise<unknown>; record(findings: unknown): Promise<string> };
