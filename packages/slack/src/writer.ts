// The Slack writer (OA-28). Only packages/changeset imports this subpath
// (checked by scripts/check-repo.ts), and `apply` takes only a request a
// person approved: its type comes from `SourceWriter`, so nothing here can
// mint one.
//
// It posts as the person whose token it holds, and only in the channels the
// server reads: a message's `author` must be that person, and a channel any
// other is refused before anything is sent. A message it posted is undone by
// deleting it, and only while it is still that person's.
//
// Values are keyed by core's field names (`FieldValues`), for the
// conversation an item is: "summary" (Oriel's title for it, as the index
// has it), "description" (the message as plain text), "replies" (how many),
// "reply:<ts>" (one reply as plain text, or null when there is no such
// reply) and "updated" (the latest of its message, its replies and their
// edits, so a reply or an edit since moves it). A post has no before values
// and a deleted message no after values.
import {
  type FieldValues,
  type ItemId,
  itemId,
  type Log,
  object,
  parseItemId,
  SourceRefused,
  type SourceWriter,
  string,
  type WriteResult,
} from "@oriel/core";
import { methodsApi, readMethods, type SlackApi, SlackError, type WebApiOptions } from "./api.ts";
import { slackTitle } from "./attrs.ts";
import {
  escapeText,
  isSlackOp,
  isTs,
  keyParts,
  type SlackArgs,
  type SlackOp,
  slackOps,
} from "./ops.ts";
import {
  deleted,
  forbidden,
  isRoot,
  posted,
  type SlackMessage,
  slackReads,
  tsInstant,
} from "./source.ts";

export const writeMethods = ["chat.postMessage", "chat.delete"] as const;
export type WriteMethod = (typeof writeMethods)[number];
export type WriterApi = SlackApi<(typeof readMethods)[number] | WriteMethod>;

// Slack's Web API with the two methods a write sends, beside the reads it
// makes before and after. Only this entry hands one out.
export function writeApi(options: WebApiOptions): WriterApi {
  return methodsApi(options, [...readMethods, ...writeMethods], "the writer");
}

export type SlackWriterOptions = {
  api: WriterApi;
  // The channels the server reads, by ID: the only ones it writes to.
  channels: readonly string[];
  log: Log;
};

const auth = object({ user_id: string });
const sent = object({ ts: string });

// Slack's codes for a write it made no change for, in a person's words.
const refusals: Record<string, string> = {
  missing_scope: "Oriel's Slack token can't post: it needs the chat:write scope",
  not_in_channel: "the person Oriel posts as isn't in that channel",
  channel_not_found: "Slack has no such channel that Oriel can see",
  is_archived: "the channel is archived",
  cant_delete_message: "Slack won't let Oriel delete that message",
  message_not_found: "the message isn't in Slack any more",
  msg_too_long: "the message is too long for Slack",
  restricted_action: "the workspace doesn't let this person post there",
};

const reply = (ts: string) => `reply:${ts}`;

export function slackWriter(options: SlackWriterOptions): SourceWriter<"slack"> {
  const { api, log } = options;
  const allowed = new Set(options.channels);

  // Who the token is for, asked once it answers.
  let me: Promise<string> | null = null;
  const self = (): Promise<string> => {
    me ??= api("auth.test", {}).then((body) => {
      const parsed = auth(body);
      if (!parsed.ok) throw new Error("slack: auth.test: unexpected reply");
      return parsed.value.user_id;
    });
    me.catch(() => {
      me = null;
    });
    return me;
  };

  // Read as the source reads them, so a diff names a conversation as the
  // window does.
  const reads = slackReads(api, log);

  const where = (id: ItemId<"slack">) => {
    const parsed = parseItemId(id);
    const parts = parsed?.source === "slack" ? keyParts(parsed.key) : null;
    if (!parts) throw new RangeError(`not a Slack item: ${id}`);
    return parts;
  };

  // A message and its replies, oldest first, or "gone": deleted, or in a
  // channel the server doesn't read.
  const conversation = async (
    channel: string,
    ts: string,
  ): Promise<{ root: SlackMessage; replies: SlackMessage[] } | "gone"> => {
    if (!allowed.has(channel)) return "gone";
    const thread = await reads.conversation(channel, ts).catch((error: unknown) => {
      if (error instanceof SlackError && (deleted.has(error.code) || forbidden.has(error.code)))
        return "gone" as const;
      throw error;
    });
    if (thread === "gone") return "gone";
    const root = thread.find((m) => m.ts === ts);
    if (!isRoot(root)) return "gone";
    return { root, replies: thread.filter((m) => m.ts !== ts && posted.has(m.subtype)) };
  };

  // The conversation's current values for `names`, or "gone". Its update
  // time is the latest of its message, its replies and their edits, so any
  // of them since moves it.
  const values = async (
    id: ItemId<"slack">,
    names: readonly string[],
  ): Promise<
    { thread: { root: SlackMessage; replies: SlackMessage[] }; values: FieldValues } | "gone"
  > => {
    const { channel, ts } = where(id);
    const thread = await conversation(channel, ts);
    if (thread === "gone") return "gone";
    const { root, replies } = thread;
    const named = reads.people();
    const read = async (name: string): Promise<unknown> => {
      if (name === "summary") {
        const { author, body } = await named(root);
        return slackTitle(author.name, body);
      }
      if (name === "description") return (await named(root)).body;
      if (name === "replies") return replies.length;
      if (name === "updated") {
        const times = [root, ...replies].flatMap((m) => [m.ts, ...(m.edited ? [m.edited.ts] : [])]);
        return tsInstant(times.filter(isTs).toSorted().at(-1) ?? ts);
      }
      if (name.startsWith("reply:")) {
        const found = replies.find((m) => reply(m.ts) === name);
        return found ? (await named(found)).body : null;
      }
      throw new RangeError(`not a Slack field: ${name}`);
    };
    const entries = await Promise.all(names.map(async (name) => [name, await read(name)] as const));
    return { thread, values: Object.fromEntries(entries) };
  };

  // The conversation a write targets, as it is now, so long as its handle
  // still names the item with the stable ID expected of it.
  const existing = async (target: Target, names: readonly string[]) => {
    if (target === null) throw new Error("this operation needs a conversation");
    if (parseItemId(target.id)?.key !== target.stableId)
      throw new Error(`${target.id} names another conversation (expected ${target.stableId})`);
    const { channel, ts } = where(target.id);
    if (!allowed.has(channel))
      throw new Error("Oriel doesn't read that channel, so it won't write there");
    const found = await values(target.id, names);
    if (found === "gone") throw new Error(`${target.id} is gone from Slack`);
    return {
      ...found,
      id: target.id,
      channel,
      ts,
      item: { id: target.id, stableId: target.stableId },
    };
  };

  // Once Slack has taken a write, the change set must hear about it, so a
  // failed read afterwards leaves `after` empty instead of throwing. Revert's
  // conflict check then has nothing to match, and stops.
  const afterwards = async (id: ItemId<"slack">, names: readonly string[]) => {
    try {
      const found = await values(id, [...names, "updated"]);
      if (found === "gone") throw new Error("gone");
      return found.values;
    } catch (error) {
      log("slack: wrote, but couldn't read the result back", {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      return {};
    }
  };

  const asSelf = async (author: string) => {
    if (author !== (await self()))
      throw new Error("Oriel reads Slack as someone else now, so it won't post as this person");
  };

  const postMessage = async (
    send: Send,
    { channel, text: said, author }: SlackArgs<"postMessage">,
  ): Promise<WriteResult<"slack">> => {
    if (!allowed.has(channel))
      throw new Error("Oriel doesn't read that channel, so it won't post there");
    await asSelf(author);
    const ts = await send("chat.postMessage", { channel, text: escapeText(said), mrkdwn: "false" });
    const id = itemId("slack", `${channel}-${ts}`);
    return {
      item: { id, stableId: `${channel}-${ts}` },
      before: {},
      after: await afterwards(id, ["summary", "description"]),
    };
  };

  const replyTo = async (
    send: Send,
    target: Target,
    { text: said, author }: SlackArgs<"reply">,
  ): Promise<WriteResult<"slack">> => {
    await asSelf(author);
    const before = await existing(target, ["replies"]);
    const ts = await send("chat.postMessage", {
      channel: before.channel,
      thread_ts: before.ts,
      text: escapeText(said),
      mrkdwn: "false",
    });
    return {
      item: before.item,
      before: { [reply(ts)]: null, replies: before.values.replies },
      after: await afterwards(before.id, [reply(ts), "replies"]),
    };
  };

  // Only a message the token's person posted is deleted.
  const own = async (m: SlackMessage | undefined, what: string) => {
    if (!m) throw new Error(`${what} isn't in Slack any more`);
    if (m.user !== (await self()))
      throw new Error(`${what} isn't the posting person's own, so Oriel won't delete it`);
  };

  const deleteMessage = async (send: Send, target: Target): Promise<WriteResult<"slack">> => {
    const before = await existing(target, ["summary", "description"]);
    await own(before.thread.root, "the message");
    if (before.thread.replies.length)
      throw new Error("the message has replies now, and deleting it would leave them without it");
    await send("chat.delete", { channel: before.channel, ts: before.ts });
    return { item: before.item, before: before.values, after: {} };
  };

  const deleteReply = async (
    send: Send,
    target: Target,
    { ts }: SlackArgs<"deleteReply">,
  ): Promise<WriteResult<"slack">> => {
    const before = await existing(target, [reply(ts), "replies"]);
    await own(
      before.thread.replies.find((m) => m.ts === ts),
      "the reply",
    );
    await send("chat.delete", { channel: before.channel, ts });
    return {
      item: before.item,
      before: before.values,
      after: await afterwards(before.id, [reply(ts), "replies"]),
    };
  };

  const write = (send: Send, op: SlackOp, target: Target, args: unknown) => {
    switch (op) {
      case "postMessage":
        if (target !== null) throw new Error("postMessage: a post has no target");
        return postMessage(send, valid("postMessage", args));
      case "reply":
        return replyTo(send, target, valid("reply", args));
      case "deleteMessage":
        valid("deleteMessage", args);
        return deleteMessage(send, target);
      case "deleteReply":
        return deleteReply(send, target, valid("deleteReply", args));
    }
  };

  return {
    kind: "slack",
    // A target must come with the stable ID it is expected to have, and a
    // post with none. A failure before the write went out sent nothing.
    apply: async ({ op, target, expectedStableId, args }) => {
      const state = { sent: false };
      // The one request that writes. Slack refusing it made no change.
      const send: Send = async (method, params) => {
        state.sent = true;
        let body: unknown;
        try {
          body = await api(method, params);
        } catch (error) {
          if (error instanceof SlackError)
            throw new SourceRefused(refusals[error.code] ?? `Slack refused it (${error.code})`, {
              sent: true,
              cause: error,
            });
          throw error;
        }
        if (method === "chat.delete") return "";
        const made = sent(body);
        if (!made.ok || !isTs(made.value.ts))
          throw new Error("chat.postMessage: Slack's answer had no ts");
        return made.value.ts;
      };
      try {
        if (!isSlackOp(op)) throw new Error(`not a Slack operation: ${op}`);
        if ((target === null) !== (expectedStableId === null))
          throw new Error(
            `${op}: a target needs the stable ID to check it against, and only one does`,
          );
        return await write(
          send,
          op,
          target === null || expectedStableId === null
            ? null
            : { id: target, stableId: expectedStableId },
          args,
        );
      } catch (error) {
        if (state.sent || error instanceof SourceRefused) throw error;
        const said = error instanceof Error ? error.message : String(error);
        throw new SourceRefused(said, { sent: false, cause: error });
      }
    },
    current: async (id, fields) => {
      const found = await values(id, fields);
      return found === "gone" ? "gone" : found.values;
    },
    read: async (id, fields) => {
      const found = await values(id, fields);
      const key = parseItemId(id)?.key ?? "";
      return found === "gone" ? "gone" : { stableId: key, values: found.values };
    },
    // A person by their user ID, or a channel the server reads by its ID.
    name: async (id) => {
      if (/^[UW][A-Z0-9]+$/.test(id)) return reads.personName(id);
      if (!allowed.has(id)) return null;
      try {
        return await reads.channelName(id);
      } catch (error) {
        if (error instanceof SlackError) return null;
        throw error;
      }
    },
  };
}

type Target = { id: ItemId<"slack">; stableId: string } | null;
// Sends the one write request; resolves to the `ts` Slack gave a post.
type Send = (method: WriteMethod, params: Record<string, string>) => Promise<string>;

function valid<O extends SlackOp>(op: O, args: unknown): SlackArgs<O> {
  const result = slackOps[op].args(args, "$.args");
  if (result.ok) return result.value as SlackArgs<O>;
  const at = result.issues.map((i) => `${i.path}: ${i.message}`).join("; ");
  throw new Error(`${op}: bad arguments (${at})`);
}
