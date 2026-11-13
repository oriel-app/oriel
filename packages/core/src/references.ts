// An adapter hands each record's text beside the record, never in it; Oriel's sync runs the recognizers over it and drops it.
import type { ItemId } from "./ids.ts";

// It never throws, whatever the text.
export type Recognizer = (text: string) => ItemId[];

export function recognizeAll(recognizers: readonly Recognizer[]): Recognizer {
  return (text) => [...new Set(recognizers.flatMap((recognize) => recognize(text)))];
}
