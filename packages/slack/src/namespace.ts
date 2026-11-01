// The `slack` namespace of a region's module (OA-28): a write for each op in
// Slack's catalogue a run may capture. Bindings build it only for a region
// holding Slack conversations. A message goes only in the channel of one of
// them, and a reply only in one of them, and only where the server reads;
// both post as the person Oriel reads Slack as, whom the composition root
// names in the context. Reading a conversation is `items.read()`, as for any
// item.
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
import { keyParts, slackOps } from "./ops.ts";

// What only the composition root knows: the channels the server reads, by
// ID, and who Oriel posts as, by user ID. Absent while Slack isn't connected,
// when nothing can be posted.
export type SlackContext = { channels: readonly string[]; author: string } | undefined;

const channelOf = (id: string): string | null => {
  const parsed = parseItemId(id);
  return parsed?.source === "slack" ? (keyParts(parsed.key)?.channel ?? null) : null;
};

// The channel of a conversation in the region, so long as Oriel reads it:
// anything else is refused with what to use.
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

// What a Slack item is, in the declarations' `Item` (see `ItemDocs` in
// bindings): shape only, never source text. Its text is `slackText`'s.
export const slackItemDoc =
  "A Slack item is a chat message in a channel, not a ticket: its title is its author and first line, its text the message and then each reply in its thread, each with its author and time. It has no status, assignee or estimate, and its channel isn't an epic. Name it by who wrote it, where and when.";

// Slack's namespace. With no context, Slack isn't connected, and it offers
// nothing to write.
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
          // Nothing later in the run writes to a new message.
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
          params: [param("id", "SlackId", string), param("text", "string", string)],
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
