// References (decision 0027): an item's naming of another item in its text,
// such as a Slack message naming SYN-54. ("Mention" is for naming a person.)
// Each source declares a recognizer for its own item IDs, and knows no other
// source's format. At sync an adapter hands each record's text beside the
// record, never in it; Oriel's sync runs every source's recognizer over it,
// the index resolves what they found by stable ID, and the text is dropped.
// A recognizer is pure and needs no index, so anything holding text, such as
// the item panel, can run the same ones.
import type { ItemId } from "./ids.ts";

// From any text to the item IDs a source recognizes in it, in the order
// found, each once. It never throws, whatever the text.
export type Recognizer = (text: string) => ItemId[];

// Every recognizer given, as one: what any of them finds, each once.
export function recognizeAll(recognizers: readonly Recognizer[]): Recognizer {
  return (text) => [...new Set(recognizers.flatMap((recognize) => recognize(text)))];
}
