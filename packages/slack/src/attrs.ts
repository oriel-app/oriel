// What the index keeps per Slack message beyond core's fields, what a read
// returns, and how Slack shows in the window. An item is a message posted in
// a channel, not as a reply, with its replies. Its one facet is its kind,
// "message": a channel isn't an epic, and a message has no assignee, state
// or estimate (decision 0021). Its author is in attrs and in its title.
import {
  array,
  type DetailsOf,
  type Facets,
  type IndexRecord,
  type Instant,
  isInstant,
  nullable,
  number,
  object,
  parseItemId,
  type Presentation,
  refine,
  string,
  type Validator,
} from "@oriel/core";

export type SlackPerson = {
  // Their Slack user ID; null for an app that posted as itself.
  id: string | null;
  name: string;
};

export type SlackAttrs = {
  channel: { id: string; name: string };
  author: SlackPerson;
  replies: number;
};

export type SlackRecord = IndexRecord<"slack", SlackAttrs>;

// A message read live: the root and every reply, each as plain text.
export type SlackContent = {
  channel: { id: string; name: string };
  author: SlackPerson;
  postedAt: Instant;
  // When the root's text last changed, or null if it never has.
  editedAt: Instant | null;
  body: string;
  replies: { author: SlackPerson; at: Instant; body: string }[];
  // What any item's read returns: the author and the start of the message as
  // the title, and the whole conversation as one plain text.
  title: string;
  text: string;
};

const person = object({ id: nullable(string), name: string });
const channel = object({ id: string, name: string });
const at = refine(string, isInstant, "expected an instant");

export const slackAttrs = object({
  channel,
  author: person,
  replies: number,
}) satisfies Validator<SlackAttrs>;

// What a read returns, checked where it is used: a reader may sit behind any
// transport.
export const slackContent = object({
  channel,
  author: person,
  postedAt: at,
  editedAt: nullable(at),
  body: string,
  replies: array(object({ author: person, at, body: string })),
  title: string,
  text: string,
}) satisfies Validator<SlackContent>;

export const slackFacets = (): Facets => ({ kind: "message" });

// A record's Slack attrs, or null for another source's item.
export function slackAttrsOf(record: IndexRecord): SlackAttrs | null {
  if (parseItemId(record.id)?.source !== "slack") return null;
  const parsed = slackAttrs(record.attrs);
  return parsed.ok ? parsed.value : null;
}

// A message shows its channel as a label. Slack has no status.
export const slackDetails: DetailsOf = (record) => {
  const attrs = slackAttrsOf(record);
  return attrs && { type: "message", status: "", labels: [`#${attrs.channel.name}`] };
};

export const slackPresentation: Presentation = { name: "Slack", details: slackDetails };

// What a message is, in the declarations' `Item` (see `ItemDocs` in
// bindings): shape only, never source text. Its text is `slackText`'s.
export const slackItemDoc =
  "A Slack item is a chat message in a channel, not a ticket: its title is its author and first line, its text the message and then each reply in its thread, each with its author and time. It has no status, assignee or estimate, and its channel isn't an epic. Name it by who wrote it, where and when.";

const titleChars = 120;

// "Author: " and the first line with text, cut at a word near the limit. A
// message has no title of its own, so this is Oriel's, built from its text
// the same way every time.
export function slackTitle(author: string, body: string): string {
  const line = body
    .split("\n")
    .map((part) => part.trim())
    .find(Boolean);
  const title = `${author}: ${line ?? "(no text)"}`;
  const chars = [...title];
  if (chars.length <= titleChars) return title;
  const cut = chars.slice(0, titleChars - 1).join("");
  const space = cut.lastIndexOf(" ");
  return `${space > titleChars / 2 ? cut.slice(0, space) : cut}…`;
}

// The root with its author, channel and time, then each reply with its
// author and time, separated by blank lines.
export function slackText(content: Omit<SlackContent, "title" | "text">): string {
  return [
    `${content.author.name} in #${content.channel.name}, ${content.postedAt}${content.editedAt ? ` (edited ${content.editedAt})` : ""}:\n${content.body}`,
    ...content.replies.map((reply) => `${reply.author.name} replied, ${reply.at}:\n${reply.body}`),
  ].join("\n\n");
}
