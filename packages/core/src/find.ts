// The one search over Oriel's threads (OA-108, OA-110): pure, so it is
// tested without a database or a clock. The server's read layer gathers the
// workspace's threads, what was said in them and what their change sets
// wrote; this says which match a query, best first, and the words around
// each match. An eval's workspace is searched by the same code.
import type { ChangeSetRead, MatchedIn, ThreadFound, ThreadRead } from "./oriel-reads.ts";

// What can be found: a thread, by its name and what was said in it, or a
// change set, by what it wrote. `at` breaks ties, latest first.
export type Findable<T> = {
  target: T;
  at: string;
  fields: readonly { in: MatchedIn; text: string }[];
};

export type Match<T> = { target: T; matched: MatchedIn; excerpt: string };

// A query reads as at most this many words, of at most this many characters.
const maxWords = 12;
const maxWordChars = 64;
// How much of a field shows around the first word it matched.
const before = 40;
const excerptChars = 140;

// What a change set wrote is the most specific answer, a thread and a
// moment in it; then a thread's name; then what was said, where a question
// about something repeats its words (as the thread asking does).
const weight: Record<MatchedIn, number> = { "change-set": 3, name: 2, chat: 1 };

const fold = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

// Words a question is asked with, which say nothing about what it is
// after: "where did I approve the post?" looks for "approve" and "post".
const asking = new Set(
  (
    "a an and are at did do does for from had has have how i in is it me my of on or our " +
    "the this that to was we were what when where which who why with you your"
  ).split(" "),
);

// The words of a query, folded: letters and digits, so punctuation and
// accents don't stop a match. A question's own words are left out, unless
// they are all it has.
export function words(query: string): string[] {
  const found = [
    ...new Set(
      (fold(query).match(/[\p{L}\p{N}]+/gu) ?? []).map((word) => word.slice(0, maxWordChars)),
    ),
  ];
  const meant = found.filter((word) => !asking.has(word));
  return (meant.length ? meant : found).slice(0, maxWords);
}

// A field folded character by character, with where each folded unit came
// from, so a match points back into the text as written.
function folded(text: string): { text: string; from: number[] } {
  let out = "";
  const from: number[] = [];
  let at = 0;
  for (const char of text) {
    const unit = fold(char);
    out += unit;
    for (let i = 0; i < unit.length; i++) from.push(at);
    at += char.length;
  }
  return { text: out, from };
}

// Where `word` starts a word in `text`, or -1.
function startOf(text: string, word: string): number {
  for (let at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + 1))
    if (at === 0 || !/[\p{L}\p{N}]/u.test(text[at - 1] ?? "")) return at;
  return -1;
}

// A field's text around `at`, on one line, cut at spaces, with an ellipsis
// where it was cut.
function excerpt(text: string, at: number): string {
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

// What matches every word of `query` as the start of a word, best first: by
// where the words matched (what was written over a name over what was said),
// then latest first. When nothing matches every word, what matches the most
// of them, so a question asked in a sentence still finds its answer. Each
// match shows the field that matched the most words, around the first.
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

// Threads by their names and what was said in them (`said`), and change sets
// by what each wrote, where, and where it stands, so "approved" finds the
// change set the person approved.
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
