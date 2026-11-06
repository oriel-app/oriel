// The one search over the index's items (decision 0027, OA-242, OA-264):
// search() in every thread, Browse's item search and an eval's world all
// match with the index's full-text table, item_search, over each item's
// key, title and text as `indexFold` folds them. This is the pure part: the
// query the table is asked, and how what it finds is ranked.
import { excerpt, folded, searchFold, startOf, unspaced } from "./find.ts";
import { parseItemId, type SourceKind } from "./ids.ts";
import type { IndexRecord, Searched } from "./source.ts";

// What the index holds of a key, a title or a text, and how it reads a
// query's term: searchFold, with each character of a script written without
// spaces set apart, with the marks it carries, so a term there is found
// wherever it starts, as a thread's search finds it (find.ts).
const everyUnspaced = new RegExp(`${unspaced.source}\\p{M}*`, "gu");
export const indexFold = (text: string) => searchFold(text).replace(everyUnspaced, " $& ");

// The model writes search queries, and synced content can steer it, so search
// work is bounded.
const maxQueryChars = 256;
const maxTerms = 8;
export const maxSearchResults = 50;

// How much of an item's text the index keeps for search: synced text is
// anyone's.
export const maxSearchText = 8192;

// The connections records are from, by their IDs' prefixes.
export const prefixesOf = (records: readonly { id: string }[]): Set<string> =>
  new Set(records.flatMap((record) => parseItemId(record.id)?.prefix ?? []));

// A query as search() takes it: at most 256 characters and 8 distinct
// terms, folded, with the prefix of a connection in `prefixes` dropped from
// a term, so a full item ID, such as "jira:syn-12", works as a query. Text
// that only looks like one, such as "fix:login", stays as written. A term
// with no letter or digit, such as "-" or "✨", can't be found, so it isn't
// one. `whole` is the query as one key.
export function searchTerms(
  query: string,
  prefixes: ReadonlySet<string>,
): { terms: string[]; whole: string } {
  const keyOf = (term: string) => {
    const at = term.indexOf(":");
    return at > 0 && prefixes.has(term.slice(0, at)) ? term.slice(at + 1) : term;
  };
  // A control character, NUL among them, is a space.
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

// The full-text query for `terms`, or null for none: every term must be
// in the item's key, title or text, each as a phrase of its words whose
// last may run on, so "syn-1" finds SYN-12 and "resume" finds "résumés".
// Each is quoted, so nothing a person or the model types is the table's
// query syntax: AND, NEAR, *, ", -, ^ and a column's name are words.
// `titled` asks the same of the key and title alone.
export function matchQuery(terms: readonly string[]): { any: string; titled: string } | null {
  const phrases = terms.map((term) => `"${indexFold(term).replaceAll('"', '""')}"*`);
  if (!phrases.length) return null;
  const all = phrases.join(" AND ");
  return { any: all, titled: `{key title} : (${all})` };
}

// What the index found: a live record; whether every term was in its key or
// title ("title") or needed its text too ("text"); and its key and title,
// searchFold-ed, to rank it by.
export type Found<R> = { record: R; matched: "title" | "text"; key: string; title: string };

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

// The escape hatch's results, from what the index found for `terms`. Key
// and title hits come first, then text hits; within each, an exact key, then
// titles starting with the first term, then the most recently updated, then
// by item ID. How
// often a term appears never counts, so text can't rank itself by repeating
// a word. A text hit carries Oriel's excerpt of the words around the first
// term its key and title lack: at most 140 characters of its text (`written`,
// as the index keeps it), with an ellipsis where it was cut. At most 50.
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
      // A key, title or term as the index reads it, its words alone.
      const wordsOf = (of: string) => (of.match(/[\p{L}\p{N}\p{M}]+/gu) ?? []).join(" ");
      const named = wordsOf(`${key} ${title}`);
      // Where a term is in the text: as written, or else its first word, so
      // "SMS-wording" and '"SMS"' find "SMS wording".
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
