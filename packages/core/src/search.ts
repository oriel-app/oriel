import { excerpt, folded, searchFold, startOf, unspaced } from "./find.ts";
import { parseItemId, type SourceKind } from "./ids.ts";
import type { IndexRecord, Searched } from "./source.ts";

const everyUnspaced = new RegExp(`${unspaced.source}\\p{M}*`, "gu");
export const indexFold = (text: string) => searchFold(text).replace(everyUnspaced, " $& ");

// The model writes search queries, and synced content can steer it, so search
// work is bounded.
const maxQueryChars = 256;
const maxTerms = 8;
export const maxSearchResults = 50;

// Synced text is anyone's, so the index keeps only this much of an item's for search.
export const maxSearchText = 8192;

export const prefixesOf = (records: readonly { id: string }[]): Set<string> =>
  new Set(records.flatMap((record) => parseItemId(record.id)?.prefix ?? []));

export function searchTerms(
  query: string,
  prefixes: ReadonlySet<string>,
): { terms: string[]; whole: string } {
  const keyOf = (term: string) => {
    const at = term.indexOf(":");
    return at > 0 && prefixes.has(term.slice(0, at)) ? term.slice(at + 1) : term;
  };
  const bounded = searchFold(query.slice(0, maxQueryChars)).replace(/\p{Cc}/gu, " ");
  const stripped = bounded
    .split(/\s+/)
    .map(keyOf)
    .filter((term) => /[\p{L}\p{N}]/u.test(term));
  return {
    terms: [...new Set(stripped)].slice(0, maxTerms),
    whole: keyOf(bounded.trim()),
  };
}

// Each term is quoted, so nothing a person or the model types is the table's query syntax.
export function matchQuery(terms: readonly string[]): { any: string; titled: string } | null {
  const phrases = terms.map((term) => `"${indexFold(term).replaceAll('"', '""')}"*`);
  if (!phrases.length) return null;
  const all = phrases.join(" AND ");
  return { any: all, titled: `{key title} : (${all})` };
}

export type Found<R> = { record: R; matched: "title" | "text"; key: string; title: string };

export const searchedOf = (
  record: IndexRecord<SourceKind, unknown> & { excerpt?: string },
): Searched => ({
  id: record.id,
  title: record.title,
  location: record.location,
  updatedAt: record.updatedAt,
  ...(record.excerpt === undefined ? {} : { excerpt: record.excerpt }),
});

// How often a term appears never counts, so text can't rank itself by repeating a word.
export function ranked<R extends IndexRecord<SourceKind, unknown>>(
  found: readonly Found<R>[],
  { terms, whole }: { terms: readonly string[]; whole: string },
  limit: number,
  written: (id: R["id"]) => string | undefined,
): (R & { excerpt?: string })[] {
  const first = terms[0];
  const count = Math.min(Math.max(Math.trunc(limit) || 0, 1), maxSearchResults);
  if (first === undefined) return [];
  return found
    .toSorted(
      (a, b) =>
        Number(b.matched === "title") - Number(a.matched === "title") ||
        Number(b.key === whole) - Number(a.key === whole) ||
        Number(b.title.startsWith(first)) - Number(a.title.startsWith(first)) ||
        b.record.updatedAt.localeCompare(a.record.updatedAt) ||
        (a.record.id < b.record.id ? -1 : a.record.id > b.record.id ? 1 : 0),
    )
    .slice(0, count)
    .map(({ record, matched, key, title }) => {
      const text = matched === "text" ? written(record.id) : undefined;
      if (text === undefined) return record;
      const { text: flat, from } = folded(text);
      const wordsOf = (of: string) => (of.match(/[\p{L}\p{N}\p{M}]+/gu) ?? []).join(" ");
      const named = wordsOf(`${key} ${title}`);
      const where = (term: string) => {
        const whole = startOf(flat, term);
        return whole >= 0 ? whole : startOf(flat, wordsOf(term).split(" ")[0] ?? term);
      };
      const term =
        terms.find((each) => startOf(named, wordsOf(each)) < 0 && where(each) >= 0) ??
        terms.find((each) => where(each) >= 0);
      const at = term === undefined ? 0 : where(term);
      return { ...record, excerpt: excerpt(text, from[at] ?? 0) };
    });
}
