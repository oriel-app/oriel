// Its state is derived from what happened in it, never stored (packages/db derives it).
import { lookingAt } from "./about.ts";
import { holderName, maxMessageChars, maxReasonChars } from "./actions.ts";
import { type Instant, isUlid, type Ulid } from "./ids.ts";
import {
  array,
  boolean,
  type Infer,
  literal,
  number,
  object,
  refine,
  string,
  union,
} from "./validate.ts";

export const threadStates = ["working", "done", "handed-off", "dropped"] as const;
export type ThreadState = (typeof threadStates)[number];

export type Thread = {
  id: Ulid;
  workspaceId: Ulid;
  workstreamId: Ulid;
  regionVersion: number;
  state: ThreadState;
  doneBy: "applied" | "marked" | null;
  createdAt: Instant;
};

// Nothing held reaches the agent until the user sends it. A thread's held message quotes the agent's words,
// so it reaches the agent as Oriel's note, never as the user's.
export const heldSender = union(
  object({
    kind: literal("review-link"),
    by: holderName,
    changeSet: refine(string, isUlid, "expected a change set ID"),
    askFirst: boolean,
  }),
  object({
    kind: literal("window-chat"),
    chat: refine(string, isUlid, "expected a thread ID"),
    seq: refine(number, (n) => Number.isInteger(n) && n > 0, "expected a chat entry's place"),
    about: lookingAt,
  }),
  object({ kind: literal("thread"), thread: refine(string, isUlid, "expected a thread ID") }),
);
export type HeldSender = Infer<typeof heldSender>;

export const maxHeldChars: Record<HeldSender["kind"], number> = {
  "review-link": maxReasonChars,
  "window-chat": maxMessageChars,
  thread: maxMessageChars,
};

export const heldText = (from: HeldSender, text: string): boolean =>
  text.trim() !== "" && text.length <= maxHeldChars[from.kind];

// Oriel's, never the agent's: the agent reads it as a note from Oriel, never as something it said.
export const maxUnknownChips = 20;
export const maxQuotes = 20;
export const maxQuoteChars = 8_000;
const chipIdValue = refine(string, (id) => id !== "" && id.length <= 600, "expected a chip's ID");
const rejectedNote = object({
  kind: literal("rejected"),
  changeSet: refine(string, isUlid, "expected a change set ID"),
  via: union(literal("thread"), literal("review-link")),
});
const unrejectedNote = object({
  kind: literal("unrejected"),
  changeSet: refine(string, isUlid, "expected a change set ID"),
});
const unknownChipsNote = object({
  kind: literal("unknown-chips"),
  ids: refine(
    array(chipIdValue),
    (ids) => ids.length > 0 && ids.length <= maxUnknownChips,
    `expected 1 to ${maxUnknownChips} IDs`,
  ),
});
const quoteCheck = object({
  id: chipIdValue,
  text: refine(string, (text) => text !== "" && text.length <= maxQuoteChars, "expected a quote"),
  found: boolean,
});
export type QuoteCheck = Infer<typeof quoteCheck>;
const continuedNote = object({
  kind: literal("continued"),
  thread: refine(string, isUlid, "expected a thread ID"),
  quote: refine(
    string,
    (text) => text.trim() !== "" && text.length <= maxMessageChars,
    "expected a quote",
  ),
});
export const agentNote = union(rejectedNote, unrejectedNote, unknownChipsNote, continuedNote);
export type AgentNote = Infer<typeof agentNote>;
const movingNote = object({
  kind: literal("moving"),
  changeSet: refine(string, isUlid, "expected a change set ID"),
  from: string,
  into: string,
  items: number,
});
const movedNote = object({
  kind: literal("moved"),
  changeSet: refine(string, isUlid, "expected a change set ID"),
  into: string,
  workstreams: array(refine(string, isUlid, "expected a workstream ID")),
});
const continuedInNote = object({
  kind: literal("continued-in"),
  thread: refine(string, isUlid, "expected a thread ID"),
});
export const orielNote = union(
  rejectedNote,
  unrejectedNote,
  unknownChipsNote,
  continuedNote,
  continuedInNote,
  movingNote,
  movedNote,
  object({
    kind: literal("quotes"),
    checked: refine(
      array(quoteCheck),
      (checked) => checked.length > 0 && checked.length <= maxQuotes,
      `expected 1 to ${maxQuotes} quotes`,
    ),
  }),
);
export type OrielNote = Infer<typeof orielNote>;
