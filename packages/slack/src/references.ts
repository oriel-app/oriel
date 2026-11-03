// Slack's recognizer (decision 0027): links to messages in the workspace
// Oriel reads, as a person pastes them. A reply's link names its message.
import { type ItemId, itemId, type Recognizer } from "@oriel/core";
import { slackKeyShape, slackLinked } from "./attrs.ts";

// What only the composition root knows: the workspace's address.
export type SlackScope = { workspaceUrl: string };

// A link ends at a space, or at what plain text puts around one: `<`, `>`,
// `|`, quotes and brackets. Punctuation that ends a sentence isn't part of it.
// Anything longer than a link Slack makes is no message's, and is skipped
// before it is parsed, so a crafted run of characters costs nothing.
const link = /https:\/\/[^\s<>|"'()[\]]+/g;
const maxLink = 2_048;
const sentenceEnd = new Set([".", ",", ";", ":", "!", "?"]);
const trimmed = (found: string) => {
  let end = found.length;
  while (end > 0 && sentenceEnd.has(found[end - 1] ?? "")) end--;
  return found.slice(0, end);
};

export function slackRecognizer({ workspaceUrl }: SlackScope): Recognizer {
  const origin = URL.parse(workspaceUrl)?.origin;
  if (!origin) return () => [];
  return (text) => {
    const ids = (text.match(link) ?? []).flatMap((found): ItemId[] => {
      if (found.length > maxLink) return [];
      const url = URL.parse(trimmed(found));
      const key = url?.origin === origin ? slackLinked(url) : null;
      return key !== null && slackKeyShape.test(key) ? [itemId("slack", key)] : [];
    });
    return [...new Set(ids)];
  };
}
