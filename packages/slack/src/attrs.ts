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
  id: string | null;
  name: string;
};

export type SlackAttrs = {
  channel: { id: string; name: string };
  author: SlackPerson;
  replies: number;
  // Absent when it doesn't ask, and on a message synced before Oriel kept it.
  asks?: true;
};

export type SlackRecord = IndexRecord<"slack", SlackAttrs>;

// `parts` and `files` are absent from a read made before Oriel kept them.
export type SlackContent = {
  channel: { id: string; name: string };
  author: SlackPerson;
  postedAt: Instant;
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
    editedAt?: Instant;
    broadcast?: true;
  }[];
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

// A ? that ends a word, maybe inside markup or quotes, or a full-width or Arabic one anywhere;
// not one in a link's query, or one standing alone, as in code.
export const asks = (text: string): boolean =>
  /[？؟]|[^\s?][?]+[!?*_~)\]"'”’»]*(?=\s|$)/u.test(text);

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

export function slackAttrsOf(record: IndexRecord): SlackAttrs | null {
  if (parseItemId(record.id)?.kind !== "slack") return null;
  const parsed = slackAttrs(record.attrs);
  return parsed.ok ? parsed.value : null;
}

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

// Slack copies a reply's link as `archives/<channel>/p<reply>?thread_ts=<message>`: a reply
// is part of its message, so it names the message.
export function slackLinked(link: URL): string | null {
  const at = /^\/archives\/([CG][A-Z0-9]+)\/p(\d+)(\d{6})$/.exec(link.pathname.replace(/\/+$/, ""));
  if (!at) return null;
  const [, channel = "", seconds = "", micros = ""] = at;
  const thread = link.searchParams.get("thread_ts");
  const ts = thread && /^\d+\.\d{6}$/.test(thread) ? thread : `${seconds}.${micros}`;
  return `${channel}-${ts}`;
}

export const slackKeyShape = /^[CG][A-Z0-9]{6,20}-[0-9]{10}\.[0-9]{6}$/;

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

export const slackPanel: PanelOf = (content) => {
  const read = slackContent(content);
  if (!read.ok) return null;
  const message = read.value;
  const channel = message.channel.name;
  const replies = message.replies.length;
  return {
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

export function slackText(content: Omit<SlackContent, "title" | "text">): string {
  return [
    `${content.author.name} in #${content.channel.name}, ${content.postedAt}${content.editedAt ? ` (edited ${content.editedAt})` : ""}:\n${content.body}`,
    ...content.replies.map((reply) => `${reply.author.name} replied, ${reply.at}:\n${reply.body}`),
  ].join("\n\n");
}
