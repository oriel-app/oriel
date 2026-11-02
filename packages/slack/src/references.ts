// Slack's recognizer (decision 0027): links to messages in the workspace
// Oriel reads, as a person pastes them. A reply's link names its message.
import { type ItemId, isItemId, type Recognizer } from "@oriel/core";
import { slackLinked } from "./attrs.ts";

// What only the composition root knows: the workspace's address.
export type SlackScope = { workspaceUrl: string };

// A link ends at a space, or at what plain text puts around one: `<`, `>`,
// `|`, quotes and brackets. Punctuation that ends a sentence isn't part of it.
const link = /https:\/\/[^\s<>|"'()[\]]+/g;
const trailing = /[.,;:!?]+$/;

export function slackRecognizer({ workspaceUrl }: SlackScope): Recognizer {
  const origin = URL.parse(workspaceUrl)?.origin;
  if (!origin) return () => [];
  return (text) => {
    const ids = (text.match(link) ?? []).flatMap((found): ItemId[] => {
      const url = URL.parse(found.replace(trailing, ""));
      const id = url?.origin === origin ? `slack:${slackLinked(url)}` : "";
      return isItemId(id) ? [id] : [];
    });
    return [...new Set(ids)];
  };
}
