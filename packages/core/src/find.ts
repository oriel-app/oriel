import type { ChangeSetRead, MatchedIn, ThreadFound, ThreadRead } from "./oriel-reads.ts";

export type Findable<T> = {
  target: T;
  at: string;
  fields: readonly { in: MatchedIn; text: string }[];
};

export type Match<T> = { target: T; matched: MatchedIn; excerpt: string };

const maxWords = 12;
const maxWordChars = 64;
const before = 40;
const excerptChars = 140;

const weight: Record<MatchedIn, number> = { "change-set": 3, name: 2, chat: 1 };

// NFKD, then U+0300–U+036F dropped: "cafe" finds "Café", Cyrillic "й" folds to "и",
// and Japanese voicing marks, which sit outside the block, survive.
const diacritics = new RegExp("[\\u0300-\\u036f]", "g");
export const searchFold = (text: string) =>
  text.normalize("NFKD").replace(diacritics, "").toLocaleLowerCase("en");

const asking = new Set(
  (
    "a an and are at did do does for from had has have how i in is it me my of on or our " +
    "the this that to was we were what when where which who why with you your"
  ).split(" "),
);

export function words(query: string): string[] {
  const found = [
    ...new Set(
      (searchFold(query).match(/[\p{L}\p{N}\p{M}]+/gu) ?? []).map((word) =>
        word.slice(0, maxWordChars),
      ),
    ),
  ];
  const meant = found.filter((word) => !asking.has(word));
  return (meant.length ? meant : found).slice(0, maxWords);
}

export function folded(text: string): { text: string; from: number[] } {
  let out = "";
  const from: number[] = [];
  let at = 0;
  for (const char of text) {
    const unit = searchFold(char);
    out += unit;
    for (let i = 0; i < unit.length; i++) from.push(at);
    at += char.length;
  }
  return { text: out, from };
}

// The index's search sets each of their characters apart too (search.ts).
export const unspaced =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

export function startOf(text: string, word: string): number {
  const anywhere = unspaced.test(word);
  for (let at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + 1))
    if (anywhere || at === 0 || !/[\p{L}\p{N}\p{M}]/u.test(text[at - 1] ?? "")) return at;
  return -1;
}

export function excerpt(text: string, at: number): string {
  const line = text.replace(/\s+/g, " ");
  const flat = text.slice(0, at).replace(/\s+/g, " ").length;
  let start = Math.max(0, flat - before);
  if (start > 0) {
    const space = line.indexOf(" ", start);
    start = space >= 0 && space < flat ? space + 1 : start;
  }
  let end = Math.min(line.length, start + excerptChars);
  if (end < line.length) {
    const space = line.lastIndexOf(" ", end);
    end = space > flat ? space : end;
  }
  const shown = line.slice(start, end).trim();
  return `${start > 0 ? "…" : ""}${shown}${end < line.length ? "…" : ""}`;
}

export function find<T>(all: readonly Findable<T>[], query: string, limit: number): Match<T>[] {
  const wanted = words(query);
  if (!wanted.length) return [];
  const scored = all.flatMap((item, order) => {
    const fields = item.fields.map((field) => {
      const { text, from } = folded(field.text);
      const at = wanted.map((word) => startOf(text, word));
      return { field, from, at, count: at.filter((i) => i >= 0).length };
    });
    const hits = wanted.filter((_, w) => fields.some((f) => (f.at[w] ?? -1) >= 0)).length;
    if (hits === 0) return [];
    const score = wanted.reduce(
      (sum, _, w) =>
        sum +
        Math.max(0, ...fields.filter((f) => (f.at[w] ?? -1) >= 0).map((f) => weight[f.field.in])),
      0,
    );
    const best = fields.toSorted(
      (a, b) => b.count - a.count || weight[b.field.in] - weight[a.field.in],
    )[0];
    if (!best) return [];
    const first = Math.min(...best.at.filter((i) => i >= 0));
    return [
      {
        hits,
        score,
        order,
        at: item.at,
        match: {
          target: item.target,
          matched: best.field.in,
          excerpt: excerpt(best.field.text, best.from[first] ?? 0),
        },
      },
    ];
  });
  const most = Math.max(0, ...scored.map((s) => s.hits));
  return scored
    .filter((s) => s.hits === most)
    .toSorted(
      (a, b) => b.score - a.score || (a.at === b.at ? a.order - b.order : a.at < b.at ? 1 : -1),
    )
    .slice(0, Math.max(0, limit))
    .map((s) => s.match);
}

export function findThreads(
  threads: readonly ThreadRead[],
  said: (thread: ThreadRead) => string,
  sets: readonly ChangeSetRead[],
  query: string,
  limit: number,
): ThreadFound[] {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const all: Findable<{ thread: ThreadRead; changeSet: ChangeSetRead | null }>[] = [
    ...threads.map((thread) => ({
      target: { thread, changeSet: null },
      at: thread.activityAt,
      fields: [
        { in: "name" as const, text: thread.name ?? "" },
        { in: "chat" as const, text: said(thread) },
      ],
    })),
    ...sets.flatMap((set) => {
      const thread = byId.get(set.thread);
      if (!thread) return [];
      const stood = set.decided
        ? `${set.state} ${set.decided.kind} by ${set.decided.by}`
        : set.state;
      return [
        {
          target: { thread, changeSet: set },
          at: set.decided?.at ?? set.createdAt,
          fields: [
            ...set.changes.map((change) => ({
              in: "change-set" as const,
              text: [`${change.source}: ${change.sentence}`, ...change.text].join("\n"),
            })),
            { in: "change-set" as const, text: stood },
          ],
        },
      ];
    }),
  ];
  return find(all, query, limit).map(({ target, matched, excerpt }) => ({
    ...target,
    matched,
    excerpt,
  }));
}
