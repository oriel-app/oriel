import {
  type ItemId,
  type NamespaceFn,
  type NamespaceHost,
  type NamespaceSpec,
  param,
  parseItemId,
  string,
  write,
} from "@oriel/core";
import { keyParts, messageText, slackOps } from "./ops.ts";

export type SlackContext = { channels: readonly string[]; author: string } | undefined;

const channelOf = (id: string): string | null => {
  const parsed = parseItemId(id);
  return parsed?.kind === "slack" ? (keyParts(parsed.key)?.channel ?? null) : null;
};

function postable(id: string, host: NamespaceHost, channels: readonly string[]): string {
  if (!host.has(id))
    throw new RangeError(
      `${JSON.stringify(id)} isn't in this region; Slack writes take only its IDs`,
    );
  const channel = channelOf(id);
  if (channel === null) throw new RangeError(`${JSON.stringify(id)} isn't a Slack conversation`);
  if (!channels.includes(channel))
    throw new RangeError(`Oriel doesn't read ${channel} now, so it can't post there`);
  return channel;
}

// Shape only, never source text: it goes into the declarations.
export const slackItemDoc =
  "A Slack item is a chat message in a channel, not a ticket: its title is its author and first line, its text the message and then each reply in its thread, each with its author and time. It has no status, assignee or estimate, and its channel isn't an epic.";

export function slackNamespace(context: SlackContext): NamespaceSpec {
  return {
    name: "Slack",
    ops: slackOps,
    types: () =>
      context === undefined
        ? []
        : [
            "/** This region's Slack conversations. */",
            "type SlackId = Extract<RegionId, `slack:${string}`>;",
          ],
    fns(): NamespaceFn[] {
      if (context === undefined) return [];
      const { author, channels } = context;
      // Each conversation takes one reply a run: a diff would show a second
      // as rewriting the first.
      const replied = new Set<string>();
      return [
        write({
          name: "postMessage",
          doc: "Post a message in the channel a conversation is in, as the person Oriel reads Slack as. Plain text, sent exactly as written: no mentions, links or formatting.",
          op: "postMessage",
          creates: false,
          params: [param("channelOf", "SlackId", string), param("text", "string", string)],
          build: ([id, text], host) => ({
            target: null,
            args: { channel: postable(id, host, channels), text, author },
          }),
        }),
        write({
          name: "reply",
          doc: "Reply in a conversation, likewise, once a run.",
          op: "reply",
          creates: false,
          // Checked here, so a refused reply doesn't use up the conversation's one.
          params: [param("id", "SlackId", string), param("text", "string", messageText)],
          build: ([id, text], host) => {
            postable(id, host, channels);
            if (replied.has(id))
              throw new RangeError(
                `${JSON.stringify(id)} has a reply in this run already; say it all in one`,
              );
            replied.add(id);
            return { target: id as ItemId<"slack">, args: { text, author } };
          },
        }),
      ];
    },
  };
}
