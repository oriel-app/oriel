// Oriel computes every signal; a model only picks a few and says why in one line, which Oriel checks: no figure,
// no link, no markup, chips only for the signal's own items. It can choose among true things, never invent one.
import type { BlockSpec } from "./block.ts";
import { isItemId, type ItemId } from "./ids.ts";
import { wordForWord } from "./quote.ts";

export const signalKinds = ["stalled", "drift", "overloaded", "contradicted", "scope"] as const;
export type SignalKind = (typeof signalKinds)[number];

export const isSignalKind = (value: string): value is SignalKind =>
  signalKinds.some((kind) => kind === value);

export type SignalSubject =
  | { kind: "workstream"; id: string; name: string }
  | { kind: "item"; id: ItemId }
  | { kind: "person"; id: string; name: string };

export type Signal = {
  id: string;
  kind: SignalKind;
  subject: SignalSubject;
  headline: string;
  rule: string;
  weight: number;
  fingerprint: string;
  items: ItemId[];
  block: BlockSpec;
};

export const maxEvidence = 4;
export const maxNotices = 4;
export const maxWhyChars = 200;
export const maxQuoteWords = 25;

export type Notice = {
  signal: Signal;
  why: string | null;
  quote: { item: ItemId; text: string } | null;
};

export type NoticeLine = {
  signal: string;
  why: string;
  quote: { item: string; text: string } | null;
};

const chip = /\[\[([^\]]+)\]\]/gu;

export const numbersIn = (text: string): string[] =>
  text.replace(chip, " ").match(/\p{Nd}+/gu) ?? [];

// `known`: numbers already in the signal's headline or its items' text; any other is a figure the model made.
export function whyProblem(
  why: string,
  allowed: ReadonlySet<string>,
  known: ReadonlySet<string> = new Set(),
): string | null {
  const text = why.trim();
  if (!text) return "it is empty";
  if ([...text].length > maxWhyChars) return `it is longer than ${maxWhyChars} characters`;
  if (/[\r\n]/u.test(text)) return "it is more than one line";
  const named = [...text.matchAll(chip)].map((match) => match[1] ?? "");
  const stray = named.filter((id) => !allowed.has(id));
  if (stray.length) return `it names ${stray.join(", ")}, which isn't behind this signal`;
  const prose = text.replace(chip, "");
  if (numbersIn(prose).some((n) => !known.has(n))) return "it carries a figure";
  if (/https?:|www\.|\w+\.\w{2,}\//iu.test(prose)) return "it carries a link";
  if (/[<>`*_#|]|\]\(|\[\[|\]\]/u.test(prose)) return "it carries markup";
  return null;
}

export function quoteFound(quote: string, text: string): boolean {
  const words = quote.trim().split(/\s+/u).filter(Boolean);
  if (!words.length || words.length > maxQuoteWords) return false;
  return wordForWord(quote, text);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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

export function checkNotice(
  line: NoticeLine,
  signals: ReadonlyMap<string, Signal>,
  texts: ReadonlyMap<string, string>,
):
  | { ok: true; notice: Notice; quoteDropped: boolean; lineProblem: string | null }
  | { ok: false; why: string } {
  const signal = signals.get(line.signal);
  if (!signal) return { ok: false, why: `${line.signal} isn't a signal Oriel offered` };
  const allowed = new Set<string>([...signal.items, subjectId(signal.subject)]);
  const known = new Set(
    [signal.headline, ...signal.items.map((id) => texts.get(id) ?? "")].flatMap(numbersIn),
  );
  const lineProblem = whyProblem(line.why, allowed, known);
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
      why: lineProblem ? null : line.why.trim(),
      quote: keep && quoted ? { item: quoted.item as ItemId, text: quoted.text.trim() } : null,
    },
    quoteDropped: quoted !== null && !keep,
    lineProblem,
  };
}

export const subjectId = (subject: SignalSubject): string => subject.id;

export type Dismissal = { signal: string; fingerprint: string };

export const dismissed = (signal: Signal, dismissals: readonly Dismissal[]): boolean =>
  dismissals.some((d) => d.signal === signal.id && d.fingerprint === signal.fingerprint);

export const teachAfter = 3;
export function kindWeights(
  dismissals: readonly { kind: SignalKind; signal: string }[],
  kept: readonly SignalKind[],
): Record<SignalKind, number> {
  return Object.fromEntries(
    signalKinds.map((kind) => {
      // Signals, not dismissals: one card dismissed again is one lesson.
      const times = new Set(dismissals.filter((d) => d.kind === kind).map((d) => d.signal)).size;
      return [kind, times >= teachAfter && !kept.includes(kind) ? 0.5 : 1];
    }),
  ) as Record<SignalKind, number>;
}
