// A second look (the challenger spike): before a person decides on a change
// set, Oriel asks an agent of its own what else the change would make wrong:
// the discussions it affects, the decisions or policy it disagrees with, the
// items worth a look, and the changes that may need to go with it. The agent
// reads the diff Oriel computed and the items it chooses, and hands Oriel
// findings, each tied to lines of the diff and resting on quotes Oriel checks
// word for word. It never approves and never blocks: the person decides, in
// Oriel's own controls, whatever it found.
//
// It is made once per change set, in a run Oriel starts when the change set
// is captured, and stored with the hash it read; never on a page view. A
// later look compares that hash and each cited item's update time with
// today's, and says what changed, so a second look can't silently stand for
// a diff it never read.
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

// The four things a second look can raise, in the order the window shows
// them.
export const findingKinds = ["conflict", "discussion", "companion", "related"] as const;
export type FindingKind = (typeof findingKinds)[number];

export const maxFindings = 8;
export const maxEvidence = 4;
export const maxSaysChars = 320;
export const maxEvidenceQuoteChars = 600;

// What a finding says is the agent's reading of its evidence. Words that
// grade the change as a whole, or tell the person to approve it, are refused:
// they are what steered or reassuring text would want a second look to say,
// and they would read as a pass. Whether to approve is the person's.
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

// What the agent hands `challenge.record()`, as it is checked first: its
// shape. What the shape can't say (lines in the diff, quotes in their items,
// changes the run captured) is the server's check.
const evidenceAsk = object({
  id: refine(string, isItemId, "expected an item's ID, such as jira:SYN-12"),
  quote: text(maxEvidenceQuoteChars, `a quote of at most ${maxEvidenceQuoteChars} characters`),
});
const findingAsk = object({
  kind: union(literal("conflict"), literal("discussion"), literal("companion"), literal("related")),
  lines: refine(array(lineNumber), (lines) => lines.length > 0, "expected at least one line"),
  says: text(maxSaysChars, `one or two sentences, at most ${maxSaysChars} characters`),
  evidence: refine(
    array(evidenceAsk),
    (evidence) => evidence.length > 0 && evidence.length <= maxEvidence,
    `expected 1 to ${maxEvidence} quotes`,
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

// What Oriel asks, as the message of the run it starts. Fixed words, with no
// ID, title or text in them: the diff, and everything the agent reads, come
// back as tool results (SPEC §5).
export const challengeAskText = `Oriel asks you for a second look at the change set this thread proposed, before the person decides on it. You don't decide whether it should be approved, and you can't change it.

Read it with challenge.diff(). Then find what it would make wrong elsewhere: discussions it affects, decisions or policy it disagrees with (a later reply may have changed an earlier decision: check who said what, and when), items worth a look, and changes that may need to go with it. Search outside the workstream where it helps.

Hand Oriel only what the items' own words show, once, with challenge.record(). A write in that same run is only a suggestion the person may add. If you find nothing, record an empty list. Your reply isn't shown.`;

// A finding as Oriel keeps it: the agent's reading, its quotes as Oriel
// found them, and, for a companion, the changes it suggests, by their place
// in the second look's `companions`.
export type Finding = {
  kind: FindingKind;
  lines: number[];
  says: string;
  // `outside`: the item isn't in the change set's workstream; the agent
  // reached it through search().
  evidence: { id: ItemId; quote: string; outside: boolean }[];
  changes: number[];
};

// What the second look read, from its runs' own records, not its words:
// which of the workstream's items it read, of how many, and how many times it
// searched outside them.
export type Coverage = { read: ItemId[]; of: number; searches: number };

// An item the second look rested on, with its update time as the index had
// it then: each target of the diff, and each item its quotes are from.
export type Basis = { id: ItemId; updatedAt: Instant | null };

export type ChallengeState = "running" | "ready" | "failed";

export type Challenge = {
  id: Ulid;
  workspaceId: Ulid;
  changeSetId: Ulid;
  threadId: Ulid;
  // The change set's hash when it was read.
  hash: string;
  state: ChallengeState;
  findings: Finding[];
  // Each change a companion suggests, as the run captured it.
  companions: CapturedMutation[];
  // Which companions the person added to the change set, by place.
  added: number[];
  coverage: Coverage | null;
  basis: Basis[];
  // Why it failed, in plain words.
  error: string | null;
  model: string | null;
  usage: { inputTokens: number; outputTokens: number };
  startedAt: Instant;
  finishedAt: Instant | null;
};

// What changed since a second look read the change set: its diff, and which
// of the items it rested on moved since.
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

// A finding as stored, checked on the way out of the database.
const storedEvidence = object({
  id: refine(string, isItemId, "expected an item ID"),
  quote: string,
  outside: boolean,
});
export const storedFinding: Validator<Finding> = object({
  kind: union(literal("conflict"), literal("discussion"), literal("companion"), literal("related")),
  lines: array(number),
  says: string,
  evidence: array(storedEvidence),
  changes: array(number),
});

// What a second look's module reaches, in a run Oriel started for it only:
// the diff Oriel computed, and where the agent hands its findings. The run
// that recorded them is the one whose captures are its companions' changes,
// so the turn gives each run its own (`ChallengeRun`).
export type ChallengeHost = {
  diff(): Promise<unknown>;
  record(runId: Ulid, findings: unknown): Promise<string>;
};
export type ChallengeRun = { diff(): Promise<unknown>; record(findings: unknown): Promise<string> };
