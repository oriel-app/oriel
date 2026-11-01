// How change sets treat Slack's ops (OA-28). Field names are core's
// (`FieldValues`), as the Slack writer reports them for the conversation an
// item is: `summary`, `description` (the message), `replies` (how many),
// `reply:<ts>` (one reply's text) and `updated`.
//
// Each line names where it posts, who it posts as, and its text exactly as it
// will read, which the diff shows as a field. Once posted, a message can be
// seen at once; a revert deletes it, and says people may have seen it
// already. Reverting a post stops if the conversation was edited or replied
// to since (its `updated` moved), and reverting a reply stops if the reply
// was edited or another came after it, rather than delete what others said
// around it.
import {
  type Conflict,
  type LineContext,
  op,
  type OpSpec,
  type OpSpecs,
  parseItemId,
  type Subject,
} from "@oriel/core";
import { keyParts, type SlackOp, slackOps } from "./ops.ts";

const maxTitleChars = 80;

function quoted(text: string): string {
  const chars = [...text.replace(/\s+/g, " ").trim()];
  const short =
    chars.length > maxTitleChars
      ? `${chars.slice(0, maxTitleChars - 1).join("")}…`
      : chars.join("");
  return `“${short}”`;
}

async function channelOf(context: LineContext, channel: string): Promise<string> {
  const name = await context.name(channel);
  return name === null ? "a channel Oriel can't name" : `#${name}`;
}

async function who(context: LineContext, user: string): Promise<string> {
  return (await context.name(user)) ?? "a person Oriel can't name";
}

// The conversation a line writes to, and its channel's name.
async function conversation(context: LineContext): Promise<{ named: string; channel: string }> {
  const subject: Subject = context.subject;
  const id = subject?.kind === "item" ? subject.id : null;
  const parsed = id === null ? null : parseItemId(id);
  const parts = parsed?.source === "slack" ? keyParts(parsed.key) : null;
  const channel = parts ? await channelOf(context, parts.channel) : "its channel";
  const title = subject?.title ?? null;
  return {
    named: title === null ? "the conversation" : `the conversation ${quoted(title)}`,
    channel,
  };
}

const seen = "People there may already have seen it.";

const ops: Record<SlackOp, OpSpec> = {
  postMessage: op(slackOps.postMessage, {
    creates: true,
    makes: "message",
    after: (a) => ({ description: a.text }),
    describe: async (a, context) =>
      `Post in ${await channelOf(context, a.channel)} as ${await who(context, a.author)}.`,
    undo: () => ({ op: "deleteMessage", args: {} }),
  }),
  reply: op(slackOps.reply, {
    // Slack names the reply when it posts it; until then it is `reply:new`.
    after: (a) => ({ "reply:new": a.text }),
    describe: async (a, context) => {
      const { named, channel } = await conversation(context);
      return `Reply in ${named} in ${channel} as ${await who(context, a.author)}.`;
    },
    undo: (_a, applied) => {
      const field = Object.keys(applied.after).find((name) => name.startsWith("reply:"));
      if (field === undefined) return { refused: "Slack didn't report which reply it posted" };
      return { op: "deleteReply", args: { ts: field.slice("reply:".length) } };
    },
  }),
  deleteMessage: op(slackOps.deleteMessage, {
    deletes: true,
    after: () => ({}),
    describe: async (_a, context) => {
      const { channel } = await conversation(context);
      const title = context.subject?.title ?? null;
      return `Delete the message ${title === null ? "Oriel posted" : quoted(title)} from ${channel}. ${seen}`;
    },
    undo: () => ({ refused: "a deleted message can't be posted again by a revert" }),
  }),
  deleteReply: op(slackOps.deleteReply, {
    after: (a) => ({ [`reply:${a.ts}`]: null }),
    describe: async (_a, context) => {
      const { named, channel } = await conversation(context);
      return `Delete the reply Oriel posted in ${named} in ${channel}. ${seen}`;
    },
    undo: () => ({ refused: "a deleted reply can't be posted again by a revert" }),
  }),
};

// Why a revert stopped, naming the conversation by its title: its key means
// nothing to a person.
function explain(conflict: Conflict, title: string | null): string {
  const named = title === null ? "a Slack message" : quoted(title);
  const { field, expected, actual } = conflict;
  if (field === "item") return `${named} is gone from Slack`;
  if (field === "updated")
    return expected === undefined || expected === null
      ? `Oriel never learned when ${named} last changed, so it can't tell whether anyone replied to it or edited it`
      : `${named} was edited or replied to since Oriel posted it, so deleting it could take others' words with it`;
  if (field === "replies") return `someone replied in ${named} since Oriel did`;
  if (field.startsWith("reply:"))
    return expected === undefined
      ? `Oriel is missing the reply it posted in ${named}, so it can't tell whether anyone changed it`
      : actual === null
        ? `the reply Oriel posted in ${named} is gone`
        : `the reply Oriel posted in ${named} was edited since`;
  return `${named}'s ${field} changed since Oriel wrote it`;
}

// What the composition root hands change sets for Slack.
export const slackSpecs: OpSpecs = {
  name: "Slack",
  titleField: "summary",
  updatedField: "updated",
  fields: { summary: "value", description: "value" },
  ops,
  explain,
};
