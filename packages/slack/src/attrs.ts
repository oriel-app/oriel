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
  literal,
  nullable,
  number,
  object,
  optional,
  type PanelBlock,
  type PanelOf,
  parseItemId,
  type Presentation,
  refine,
  string,
  union,
  type Validator,
} from "@oriel/core";
import type { SlackPart } from "./mrkdwn.ts";

export type SlackPerson = {
  // Their Slack user ID; null for an app that posted as itself.
  id: string | null;
  name: string;
};

export type SlackAttrs = {
  channel: { id: string; name: string };
  author: SlackPerson;
  replies: number;
  // Its own text asks something (`asks`), its files' names aside. Absent
  // when it doesn't, or when synced before Oriel kept it.
  asks?: true;
};

export type SlackRecord = IndexRecord<"slack", SlackAttrs>;

// A message read live: the root and every reply, each as plain text, with
// the files it shared as `[File: name]` lines. For the panel, each also has
// its own text in parts, its mentions and channels marked, and its files
// apart: absent
// from a read made before Oriel kept them.
export type SlackContent = {
  channel: { id: string; name: string };
  author: SlackPerson;
  postedAt: Instant;
  // When the root's text last changed, or null if it never has.
  editedAt: Instant | null;
  body: string;
  parts?: SlackPart[];
  files?: string[];
  replies: {
    author: SlackPerson;
    at: Instant;
    body: string;
    parts?: SlackPart[];
    files?: string[];
    // When its text last changed, if it has.
    editedAt?: Instant;
    // Sent to the channel too, as well as in reply.
    broadcast?: true;
  }[];
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
  asks: optional(literal(true)),
}) satisfies Validator<SlackAttrs>;

// Whether a message's own text, in plain words, asks something: a question
// mark that ends a word, as a sentence ends, maybe inside markup or quotes,
// or a full-width or Arabic one anywhere. Not one in a link's query, or
// standing alone, as in code.
export const asks = (text: string): boolean =>
  /[？؟]|[^\s?][?]+[!?*_~)\]"'”’»]*(?=\s|$)/u.test(text);

// What a read returns, checked where it is used: a reader may sit behind any
// transport.
const parts = optional(
  array(object({ text: string, names: optional(union(literal("person"), literal("channel"))) })),
);
const files = optional(array(string));

export const slackContent = object({
  channel,
  author: person,
  postedAt: at,
  editedAt: nullable(at),
  body: string,
  parts,
  files,
  replies: array(
    object({
      author: person,
      at,
      body: string,
      parts,
      files,
      editedAt: optional(at),
      broadcast: optional(literal(true)),
    }),
  ),
  title: string,
  text: string,
}) satisfies Validator<SlackContent>;

export const slackFacets = (): Facets => ({ kind: "message" });

// A record's Slack attrs, or null for another source's item.
export function slackAttrsOf(record: IndexRecord): SlackAttrs | null {
  if (parseItemId(record.id)?.kind !== "slack") return null;
  const parsed = slackAttrs(record.attrs);
  return parsed.ok ? parsed.value : null;
}

// A message shows its channel as a label, and how many replies it has. Slack
// has no status.
export const slackDetails: DetailsOf = (record) => {
  const attrs = slackAttrsOf(record);
  return (
    attrs && {
      type: "message",
      status: "",
      labels: [`#${attrs.channel.name}`],
      replies: attrs.replies,
    }
  );
};

// The message a link into Slack points at, by key. A reply's link, as Slack
// copies it, is `archives/<channel>/p<reply>?thread_ts=<message>`: a reply is
// part of its message, so it names the message.
export function slackLinked(link: URL): string | null {
  const at = /^\/archives\/([CG][A-Z0-9]+)\/p(\d+)(\d{6})$/.exec(link.pathname.replace(/\/+$/, ""));
  if (!at) return null;
  const [, channel = "", seconds = "", micros = ""] = at;
  const thread = link.searchParams.get("thread_ts");
  const ts = thread && /^\d+\.\d{6}$/.test(thread) ? thread : `${seconds}.${micros}`;
  return `${channel}-${ts}`;
}

// A message's channel ID and its `ts`, which Slack keeps unique in the
// channel (decision 0021). Its text is its title and content, never its key.
export const slackKeyShape = /^[CG][A-Z0-9]{6,20}-[0-9]{10}\.[0-9]{6}$/;

// A message's key is a channel ID and a time, which mean nothing to anyone,
// so it reads as a message; its title says which.
export const slackPresentation: Presentation = {
  name: "Slack",
  inSentence: "Slack",
  icon: "message",
  keysReadAs: "Message",
  columns: ["replies"],
  details: slackDetails,
  linked: slackLinked,
};

type PanelMessage = Extract<PanelBlock, { kind: "messages" }>["messages"][number];

// A message or reply as the panel shows it: its text as written, with its
// mentions and channels set apart where it has any, its files apart from the text, and
// whether it was edited or also sent to the channel.
function panelMessage(
  said: {
    author: SlackPerson;
    at: Instant;
    body: string;
    parts?: SlackPart[] | undefined;
    files?: string[] | undefined;
    editedAt?: Instant | null | undefined;
    broadcast?: true | undefined;
  },
  channel: string,
): PanelMessage {
  const { parts } = said;
  return {
    author: said.author.name,
    at: said.at,
    text: parts ? parts.map((part) => part.text).join("") : said.body,
    ...(parts?.some((part) => part.names) && {
      spans: parts.map((part) => ({
        kind: part.names === "person" ? "mention" : (part.names ?? "text"),
        text: part.text,
      })),
    }),
    ...(said.editedAt && { edited: said.editedAt }),
    ...(parts && said.files?.length && { files: said.files }),
    ...(said.broadcast && { labels: [`Also sent to #${channel}`] }),
  };
}

// A message as the panel beside the page shows it, from a live read: named
// by its channel, the message, then each reply in its thread under it, with
// its author and time, all inside the one item (decision 0021). Slack's text
// shows as written, with its mentions and channels set apart.
export const slackPanel: PanelOf = (content) => {
  const read = slackContent(content);
  if (!read.ok) return null;
  const message = read.value;
  const channel = message.channel.name;
  const replies = message.replies.length;
  return {
    // The item's own title is the message's first line, which the panel
    // shows in full just below.
    title: `#${channel}`,
    blocks: [
      {
        kind: "messages",
        heading: null,
        messages: [panelMessage({ ...message, at: message.postedAt }, channel)],
        empty: "No message.",
      },
      {
        kind: "messages",
        heading: `${replies} ${replies === 1 ? "reply" : "replies"}`,
        messages: message.replies.map((reply) => panelMessage(reply, channel)),
        empty: "No replies yet.",
      },
    ],
  };
};

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
