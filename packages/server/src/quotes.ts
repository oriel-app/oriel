// The index keeps no item's text, so the check reads it, for items in the index only.
// Oriel captions each quote from its check, never from the answer's words.
import {
  type ItemId,
  maxQuoteChars,
  wordForWord,
  maxQuotes,
  parseItemId,
  type QuoteCheck,
  type Reader,
} from "@oriel/core";
import { type QuoteFrom, quoteKey, quotesFrom } from "@oriel/web/markdown";

export async function checkQuotes(
  answers: readonly string[],
  read: Reader["read"],
): Promise<QuoteCheck[]> {
  const quotes = new Map<string, QuoteFrom>();
  for (const quote of answers.flatMap(quotesFrom))
    if (quote.text.length <= maxQuoteChars) quotes.set(quoteKey(quote), quote);
  const checked = [...quotes.values()].slice(0, maxQuotes);
  const ids = [...new Set(checked.map((quote) => quote.id))].filter(
    (id): id is ItemId => parseItemId(id) !== null,
  );
  const texts = new Map<string, string>();
  for (const result of ids.length ? await read(ids) : [])
    if (result.status === "ok")
      texts.set(result.id, `${result.content.title}\n${result.content.text}`);
  return checked.map(({ id, text }) => {
    const item = texts.get(id);
    return { id, text, found: item !== undefined && wordForWord(text, item) };
  });
}
