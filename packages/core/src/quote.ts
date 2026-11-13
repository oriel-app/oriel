// Unicode compatibility forms, curly quotes and runs of whitespace don't count; marks and case do.
const plain = (text: string) =>
  text
    .normalize("NFKC")
    .replace(/[“”„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const said = (quote: string) => plain(quote).replace(/^(?:\.{3}|["' ])+|(?:\.{3}|["' ])+$/g, "");

const wordy = /[\p{L}\p{N}]/u;

// As whole words: a quote of "safe to ship" isn't in "unsafe to ship".
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
