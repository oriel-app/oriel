// Whether a quote is an item's own words (decision 0032), as an answer's
// quotes and a Noticed card's are checked (decision 0052).

// What a quote says, and what an item says, as a reader compares them,
// literally, as the agent read the item: Unicode compatibility forms, curly
// quotes and runs of whitespace don't count. Marks do, and so does case.
const plain = (text: string) =>
  text
    .normalize("NFKC")
    .replace(/[“”„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

// The quoted words without the quote marks or ellipses around them, which
// set them apart and aren't the item's.
const said = (quote: string) => plain(quote).replace(/^(?:\.{3}|["' ])+|(?:\.{3}|["' ])+$/g, "");

const wordy = /[\p{L}\p{N}]/u;

// Whether the item's text holds the quote word for word, as whole words: a
// quote of "safe to ship" isn't in "unsafe to ship".
export const wordForWord = (quote: string, text: string): boolean => {
  const words = said(quote);
  if (words === "") return false;
  const item = plain(text);
  for (let at = item.indexOf(words); at >= 0; at = item.indexOf(words, at + 1)) {
    const before = wordy.test(words[0] ?? "") && wordy.test(item[at - 1] ?? "");
    const after = wordy.test(words.at(-1) ?? "") && wordy.test(item[at + words.length] ?? "");
    if (!before && !after) return true;
  }
  return false;
};
