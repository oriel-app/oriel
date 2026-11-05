// The one search over the index's items (decision 0027, OA-242): search()
// in every thread and Browse's item search both match with it, and an eval's
// world searches its fixtures with it. Pure, so it is tested without a
// database: the index store gives it the records and their texts.
import { excerpt, folded } from "./find.ts";
import { type ItemId, parseItemId, type SourceKind } from "./ids.ts";
import type { IndexRecord, Searched } from "./source.ts";

// Case- and accent-folded: NFKD, then the Combining Diacritical Marks block
// (U+0300–U+036F) is dropped. So "cafe" finds "Café", Cyrillic "й" folds to
// "и", and Japanese voicing marks, which sit outside the block, survive.
const diacritics = new RegExp("[\\u0300-\\u036f]", "g");
export const searchFold = (text: string) =>
  text.normalize("NFKD").replace(diacritics, "").toLocaleLowerCase("en");

// The model writes search queries, and synced content can steer it, so search
// work is bounded.
const maxQueryChars = 256;
const maxTerms = 8;
export const maxSearchResults = 50;

// How much of an item's text the index keeps for search: synced text is
// anyone's, and the index holds every item's in memory, folded.
export const maxSearchText = 8192;

// The connections records are from, by their IDs' prefixes.
export const prefixesOf = (records: readonly { id: string }[]): Set<string> =>
  new Set(records.flatMap((record) => parseItemId(record.id)?.prefix ?? []));

// A query as search() takes it: at most 256 characters and 8 distinct
// terms, folded, with the prefix of a connection in `prefixes` dropped from
// a term, so a full item ID, such as "jira:syn-12", works as a query. Text
// that only looks like one, such as "fix:login", stays as written. `whole`
// is the query as one key.
export function searchTerms(
  query: string,
  prefixes: ReadonlySet<string>,
): { terms: string[]; whole: string } {
  const keyOf = (term: string) => {
    const at = term.indexOf(":");
    return at > 0 && prefixes.has(term.slice(0, at)) ? term.slice(at + 1) : term;
  };
  const bounded = searchFold(query.slice(0, maxQueryChars));
  const stripped = bounded.split(/\s+/).map(keyOf).filter(Boolean);
  return {
    terms: [...new Set(stripped)].slice(0, maxTerms),
    whole: keyOf(bounded.trim()),
  };
}

// An item's key and title, folded, as search() matches them.
const searchable = (record: IndexRecord<SourceKind, unknown>) => ({
  key: searchFold(parseItemId(record.id)?.key ?? ""),
  title: searchFold(record.title),
});

// Where every term is: in the item's key or title, "title"; only with its
// text too, "text"; otherwise null. `text` is the item's text as the index
// keeps it, folded. How often a term appears never counts, so text can't
// rank itself by repeating a word.
export function matchOf(
  record: IndexRecord<SourceKind, unknown>,
  text: string,
  terms: readonly string[],
): "title" | "text" | null {
  if (!terms.length) return null;
  const { key, title } = searchable(record);
  const named = `${key} ${title}`;
  const missing = terms.filter((term) => !named.includes(term));
  if (!missing.length) return "title";
  return missing.every((term) => text.includes(term)) ? "text" : null;
}

// What the index gives a search of each item's text: the text folded, ""
// when it keeps none, and, for the few found by it, the text as written.
export type SearchTexts = {
  folded(id: ItemId): string;
  written(id: ItemId): string | undefined;
};

// A search's record as the agent's search() returns it (`Searched`).
export const searchedOf = (
  record: IndexRecord<SourceKind, unknown> & { excerpt?: string },
): Searched => ({
  id: record.id,
  title: record.title,
  location: record.location,
  updatedAt: record.updatedAt,
  ...(record.excerpt === undefined ? {} : { excerpt: record.excerpt }),
});

// The escape hatch's search, across `records`. Every term must appear in
// the item's key, title or text. Key and title hits come first, then text
// hits; within each, an exact key, then titles starting with the first term,
// then the most recently updated. A text hit carries Oriel's excerpt of the
// words around the first term its key and title lack: at most 140
// characters of its text, with an ellipsis where it was cut. At most 256 characters, 8 distinct terms and 50 results.
export function searchRecords<R extends IndexRecord<SourceKind, unknown>>(
  records: readonly R[],
  query: string,
  limit: number,
  texts: SearchTexts,
): (R & { excerpt?: string })[] {
  const { terms, whole } = searchTerms(query, prefixesOf(records));
  const first = terms[0];
  const count = Math.min(Math.max(Math.trunc(limit) || 0, 1), maxSearchResults);
  if (!first) return [];
  const found = records
    .flatMap((record) => {
      const matched = matchOf(record, texts.folded(record.id), terms);
      return matched ? [{ record, matched, ...searchable(record) }] : [];
    })
    .sort(
      (a, b) =>
        Number(b.matched === "title") - Number(a.matched === "title") ||
        Number(b.key === whole) - Number(a.key === whole) ||
        Number(b.title.startsWith(first)) - Number(a.title.startsWith(first)) ||
        b.record.updatedAt.localeCompare(a.record.updatedAt),
    )
    .slice(0, count);
  return found.map(({ record, matched, key, title }) => {
    const text = matched === "text" ? texts.written(record.id) : undefined;
    if (text === undefined) return record;
    const term = terms.find((each) => !`${key} ${title}`.includes(each)) ?? first;
    const { text: flat, from } = folded(text, searchFold);
    const at = flat.indexOf(term);
    return { ...record, excerpt: excerpt(text, at >= 0 ? (from[at] ?? 0) : 0) };
  });
}
