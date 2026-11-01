// Slack's catalogue of write operations (OA-28): posting in a channel, and
// replying in a conversation, which is one item. Each posts as the person
// Oriel reads Slack as, named in `author`, so what a person approves says who
// it posts as; the writer refuses it under anyone else's token. The last two
// exist only as reverts: deleteMessage undoes postMessage, deleteReply undoes
// reply.
import { type Infer, object, type OpCatalogue, refine, string } from "@oriel/core";

// How long a message may be, in characters. Slack takes more, but a person
// approves every word of it.
export const maxText = 4_000;

export const isTs = (ts: string): boolean => /^[0-9]{10}\.[0-9]{6}$/.test(ts);
export const isChannelId = (id: string): boolean => /^[CG][A-Z0-9]{6,20}$/.test(id);
const isUserId = (id: string): boolean => /^[UW][A-Z0-9]{6,20}$/.test(id);

const text = refine(
  string,
  (value) => value.trim() !== "" && [...value].length <= maxText,
  `expected 1 to ${maxText} characters`,
);
const channel = refine(string, isChannelId, "expected a channel ID, like C0123456789");
const author = refine(string, isUserId, "expected a Slack user ID, like U0123456789");
const ts = refine(string, isTs, "expected a Slack ts, like 1790071200.000100");

export const slackOps = {
  postMessage: { args: object({ channel, text, author }), revertOnly: false },
  reply: { args: object({ text, author }), revertOnly: false },
  deleteMessage: { args: object({}), revertOnly: true },
  deleteReply: { args: object({ ts }), revertOnly: true },
} as const satisfies OpCatalogue;

export type SlackOp = keyof typeof slackOps;
export type SlackArgs<O extends SlackOp> = Infer<(typeof slackOps)[O]["args"]>;

export function isSlackOp(op: string): op is SlackOp {
  return Object.hasOwn(slackOps, op);
}

// What a message's text becomes on the way to Slack: `&`, `<` and `>`
// escaped, so a mention, a broadcast to the channel or a disguised link can't
// hide in it. The message reads exactly as the diff showed it.
export const escapeText = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

// The channel and `ts` a Slack item's key names.
export function keyParts(key: string): { channel: string; ts: string } | null {
  const [channel = "", ts = "", ...rest] = key.split("-");
  return rest.length === 0 && isChannelId(channel) && isTs(ts) ? { channel, ts } : null;
}
