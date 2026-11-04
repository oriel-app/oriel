// Noticed (docs/decisions/draft-noticed.md): what Oriel finds worth a
// person's attention in their window without being asked. Oriel computes
// every signal itself, from the index, the change log and its own data, each
// with its rule and its figures, as the overview's are (decision 0027). A
// model only picks which few to show and says in one line why each may
// matter, and Oriel checks that line before it shows it: no figure, no link,
// no markup, and chips only for the signal's own items. A quote is checked
// word for word against what the model was given. So the model can choose
// among true things, and phrase them, but can't invent one.
import type { BlockSpec } from "./block.ts";
import { isItemId, type ItemId } from "./ids.ts";

export const signalKinds = ["stalled", "drift", "overloaded", "contradicted", "scope"] as const;
export type SignalKind = (typeof signalKinds)[number];

export const isSignalKind = (value: string): value is SignalKind =>
  signalKinds.some((kind) => kind === value);

// What a signal is about.
export type SignalSubject =
  | { kind: "workstream"; id: string; name: string }
  | { kind: "item"; id: ItemId }
  | { kind: "person"; id: string; name: string };

// One thing Oriel found, true by its rule, whether or not anyone should look.
export type Signal = {
  // `<kind>:<subject's ID>`, the same on every run while it holds.
  id: string;
  kind: SignalKind;
  subject: SignalSubject;
  // What it found, in Oriel's words, with Oriel's figures.
  headline: string;
  // The rule that found it, the same for every signal of its kind.
  rule: string;
  // On the overview's shared scale (`weights`): about how many items it asks
  // the person to look at.
  weight: number;
  // What a dismissal remembers: it comes back only once this changes, as
  // when a stall doubles or another message arrives.
  fingerprint: string;
  // The items behind it, whose text the run reads: never more than
  // `maxEvidence`.
  items: ItemId[];
  // The block the card shows, as a pin saves it (decision 0030): a read of
  // Oriel's that needs no region, and its form.
  block: BlockSpec;
};

// What one signal hands the run at most.
export const maxEvidence = 4;
// Cards the strip shows.
export const maxNotices = 4;
// The model's line, at most.
export const maxWhyChars = 200;
// A quote, at most, in words.
export const maxQuoteWords = 25;

// A card: Oriel's signal, and what the model said of it, checked.
export type Notice = {
  signal: Signal;
  why: string | null;
  quote: { item: ItemId; text: string } | null;
};

// What the model writes, one JSON object a line, before Oriel checks it.
export type NoticeLine = {
  signal: string;
  why: string;
  quote: { item: string; text: string } | null;
};

const chip = /\[\[([^\]]+)\]\]/gu;

// Why a model's line can't be shown, or null when it can. `allowed` holds
// the IDs it may name as chips: the signal's subject and items.
export function whyProblem(why: string, allowed: ReadonlySet<string>): string | null {
  const text = why.trim();
  if (!text) return "it is empty";
  if ([...text].length > maxWhyChars) return `it is longer than ${maxWhyChars} characters`;
  if (/[\r\n]/u.test(text)) return "it is more than one line";
  const named = [...text.matchAll(chip)].map((match) => match[1] ?? "");
  const stray = named.filter((id) => !allowed.has(id));
  if (stray.length) return `it names ${stray.join(", ")}, which isn't behind this signal`;
  const prose = text.replace(chip, "");
  // Oriel shows every figure; a digit in the model's words is one it made.
  if (/\p{Nd}/u.test(prose)) return "it carries a figure";
  if (/https?:|www\.|\w+\.\w{2,}\//iu.test(prose)) return "it carries a link";
  if (/[<>`*_#|]|\]\(|\[\[|\]\]/u.test(prose)) return "it carries markup";
  return null;
}

const squash = (text: string) => text.replace(/\s+/gu, " ").trim().toLowerCase();

// Whether a quote is in an item's text word for word, give or take spacing
// and case, and short enough to be one.
export function quoteFound(quote: string, text: string): boolean {
  const words = quote.trim().split(/\s+/u).filter(Boolean);
  if (!words.length || words.length > maxQuoteWords) return false;
  return squash(text).includes(squash(quote));
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// One line of the model's answer as a notice line, or why not. A line
// that isn't JSON at all, such as a stray sentence, is null: nothing to
// refuse.
export function parseNoticeLine(
  line: string,
): { ok: true; line: NoticeLine } | { ok: false; why: string } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return { ok: false, why: "a line isn't JSON" };
  }
  if (!isRecord(value)) return { ok: false, why: "a line isn't an object" };
  const { signal, why, quote } = value;
  if (typeof signal !== "string") return { ok: false, why: "a line names no signal" };
  if (typeof why !== "string") return { ok: false, why: `${signal} has no why` };
  if (quote === undefined || quote === null)
    return { ok: true, line: { signal, why, quote: null } };
  if (!isRecord(quote) || typeof quote.item !== "string" || typeof quote.text !== "string")
    return { ok: false, why: `${signal}'s quote isn't an item and its text` };
  return { ok: true, line: { signal, why, quote: { item: quote.item, text: quote.text } } };
}

// A checked notice from a parsed line: the signal must be one Oriel offered,
// the line must pass `whyProblem`, and a quote must be from one of its items,
// found word for word in the text the run was given, or it is dropped.
export function checkNotice(
  line: NoticeLine,
  signals: ReadonlyMap<string, Signal>,
  texts: ReadonlyMap<string, string>,
): { ok: true; notice: Notice; quoteDropped: boolean } | { ok: false; why: string } {
  const signal = signals.get(line.signal);
  if (!signal) return { ok: false, why: `${line.signal} isn't a signal Oriel offered` };
  const allowed = new Set<string>([...signal.items, subjectId(signal.subject)]);
  const problem = whyProblem(line.why, allowed);
  if (problem) return { ok: false, why: `${signal.id}: ${problem}` };
  const quoted = line.quote;
  const keep =
    quoted !== null &&
    isItemId(quoted.item) &&
    signal.items.includes(quoted.item) &&
    quoteFound(quoted.text, texts.get(quoted.item) ?? "");
  return {
    ok: true,
    notice: {
      signal,
      why: line.why.trim(),
      quote: keep && quoted ? { item: quoted.item as ItemId, text: quoted.text.trim() } : null,
    },
    quoteDropped: quoted !== null && !keep,
  };
}

export const subjectId = (subject: SignalSubject): string => subject.id;

// What a dismissal is kept as: the signal, and the fingerprint it had.
export type Dismissal = { signal: string; fingerprint: string };

// Signals a dismissal still hides: the same signal with the same
// fingerprint. One whose figures moved on comes back.
export const dismissed = (signal: Signal, dismissals: readonly Dismissal[]): boolean =>
  dismissals.some((d) => d.signal === signal.id && d.fingerprint === signal.fingerprint);

// What dismissals teach, computed, never learned by a model: a kind the
// person dismissed `teachAfter` times, and never pinned or asked about,
// weighs half, so other kinds outrank it. Each signal's rule says so.
export const teachAfter = 3;
export function kindWeights(
  dismissals: readonly { kind: SignalKind }[],
  kept: readonly SignalKind[],
): Record<SignalKind, number> {
  return Object.fromEntries(
    signalKinds.map((kind) => {
      const times = dismissals.filter((d) => d.kind === kind).length;
      return [kind, times >= teachAfter && !kept.includes(kind) ? 0.5 : 1];
    }),
  ) as Record<SignalKind, number>;
}
