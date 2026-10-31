// Slack as a source (decision 0021): read-only, so it has no op catalogue and
// no writer, and it reads only the channels the user picked. An item is a
// message posted in one of them, not as a reply; its replies are part of its
// content. `sync` lists each channel's messages into index records, and
// `read` fetches one message with its replies.
//
// No cursor, as with the folder. A reply moves its message's update time, and
// a deleted message just stops being listed, so listing only what is new
// would miss both. Every sync lists every picked channel, up to a cap, with a
// null cursor, and the sync worker's full sweep marks whatever the index has
// and the listing lacks as gone. The index skips records that haven't
// changed, so listing them again costs no snapshot.
import {
  array,
  type Infer,
  type Instant,
  instant,
  itemId,
  type Log,
  number,
  object,
  optional,
  parseItemId,
  type ReadResult,
  type Source,
  string,
  unknown,
} from "@oriel/core";
import { type SlackApi, SlackError } from "./api.ts";
import {
  type SlackAttrs,
  type SlackContent,
  slackFacets,
  type SlackPerson,
  type SlackRecord,
  slackText,
  slackTitle,
} from "./attrs.ts";
import { mentionedUsers, plainText } from "./mrkdwn.ts";

export type SlackSource = Source<"slack", SlackAttrs, SlackContent>;

export type SlackSourceOptions = {
  api: SlackApi;
  // The workspace's address, as `auth.test` gives it, such as
  // "https://example.slack.com/". Item locations are links into it.
  workspaceUrl: string;
  // The channels the user picked, by ID. Nothing else is read.
  channels: readonly string[];
  // How many messages a sync lists per channel; `maxMessagesPerChannel`
  // when absent.
  maxMessages?: number;
  log: Log;
};

// How much one sync or read takes in. A channel past its cap lists only its
// latest messages; the rest read as forbidden, hidden from Oriel, until a
// sync lists them again.
export const maxChannels = 20;
export const maxMessagesPerChannel = 2_000;
export const maxReplies = 1_000;
const pageSize = "200";

const tsShape = /^[0-9]{10}\.[0-9]{6}$/;
const channelShape = /^[CG][A-Z0-9]{6,20}$/;

// A field with the wrong type is left out rather than dropping the message,
// which the sync worker's full sweep would then mark gone. Except where
// leaving it out would change what the message is: without a good `ts` it
// has no key, and without a good `subtype` or `thread_ts` it could pass for a
// person's post. Those are skipped; a message that never lists isn't swept.
// An odd `user` leaves the author unknown, never an app.
const fields = {
  subtype: optional(string),
  user: optional(string),
  text: optional(string),
  thread_ts: optional(string),
  reply_count: optional(number),
  latest_reply: optional(string),
  username: optional(string),
  bot_profile: optional(object({ name: optional(string) })),
  edited: optional(object({ ts: string })),
  files: optional(array(object({ name: optional(string), title: optional(string) }))),
};
const message = object({ ts: string, ...fields });
type Message = Infer<typeof message> & { unknownAuthor?: true };

function looseMessage(raw: unknown): { message: Message; odd: string[] } | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const { ts } = record;
  if (typeof ts !== "string" || !tsShape.test(ts)) return null;
  const odd: string[] = [];
  const taken: Record<string, unknown> = { ts };
  for (const [key, check] of Object.entries(fields)) {
    const result = check(record[key]);
    if (result.ok) taken[key] = result.value;
    else odd.push(key);
  }
  if (odd.includes("subtype") || odd.includes("thread_ts")) return null;
  if (odd.includes("user")) taken.unknownAuthor = true;
  return { message: taken as Message, odd };
}

const page = object({
  messages: array(unknown),
  response_metadata: optional(object({ next_cursor: optional(string) })),
});
const info = object({ channel: object({ id: string, name: string }) });
const profile = object({
  profile: object({ real_name: optional(string), display_name: optional(string) }),
});

// What a person posted: a message, one an app posted as itself, a file with
// its comment, a /me. Joins, topic changes, the placeholder a deleted message
// with replies leaves, and the like aren't anyone's message.
const posted = new Set([undefined, "bot_message", "file_share", "me_message", "thread_broadcast"]);

// Slack's codes for a channel or message Oriel can't read now, and for one
// that isn't there. Anything else is a failure, not a result.
const forbidden = new Set([
  "channel_not_found",
  "not_in_channel",
  "access_denied",
  "missing_scope",
  "no_permission",
]);
const deleted = new Set(["thread_not_found", "message_not_found"]);

// A `ts` as an instant: seconds, then microseconds, which an instant keeps to
// the millisecond.
export function tsInstant(ts: string): Instant {
  const [seconds = "0", micros = "0"] = ts.split(".");
  return instant(new Date(Number(seconds) * 1000 + Math.floor(Number(micros) / 1000)));
}

// A message's item key: its channel and its `ts`.
export const slackKey = (channel: string, ts: string) => `${channel}-${ts}`;

// The link Slack gives a message, built rather than asked for:
// `chat.getPermalink` is a call per message.
export const permalink = (workspaceUrl: string, channel: string, ts: string) =>
  new URL(`archives/${channel}/p${ts.replace(".", "")}`, workspaceUrl).href;

export function slackSource(options: SlackSourceOptions): SlackSource {
  const { api, workspaceUrl, log } = options;
  const url = URL.canParse(workspaceUrl) ? new URL(workspaceUrl) : null;
  if (url?.protocol !== "https:" || !workspaceUrl.endsWith("/"))
    throw new RangeError("slack: the workspace URL must be https and end with /");
  const channels = [...new Set(options.channels)];
  if (channels.some((id) => !channelShape.test(id)))
    throw new RangeError("slack: expected channel IDs, like C0123456789");
  if (channels.length > maxChannels)
    throw new RangeError(`slack: at most ${maxChannels} channels can be picked`);
  const cap = Math.max(Math.trunc(options.maxMessages ?? maxMessagesPerChannel), 1);
  // Per channel, the oldest message the last sync listed, when it stopped at
  // the cap: older ones are left out of the index.
  const cutoff = new Map<string, string>();

  // People's names, looked up once per sync or read: a name changed since
  // shows on the next one.
  const people = () => {
    const known = new Map<string, Promise<string | null>>();
    const lookup = (id: string) => {
      let found = known.get(id);
      if (!found) {
        found = api("users.profile.get", { user: id }).then(
          (reply) => {
            const parsed = profile(reply);
            if (!parsed.ok) return null;
            const { real_name, display_name } = parsed.value.profile;
            return real_name?.trim() || display_name?.trim() || null;
          },
          (error: unknown) => {
            if (error instanceof SlackError && error.code === "user_not_found") return null;
            throw error;
          },
        );
        known.set(id, found);
      }
      return found;
    };
    // A message's author and body, with every mention in it named.
    return async (m: Message): Promise<{ author: SlackPerson; body: string }> => {
      const text = m.text ?? "";
      const ids = [...new Set([...(m.user ? [m.user] : []), ...mentionedUsers(text)])];
      const names = new Map(
        await Promise.all(ids.map(async (id) => [id, await lookup(id)] as const)),
      );
      // The author is the person in `user`, even when an app posted for them
      // and `bot_id` is set too (decision 0021). Only a message with no
      // person is the app's own.
      const author: SlackPerson = m.unknownAuthor
        ? { id: null, name: "Unknown person" }
        : m.user
          ? { id: m.user, name: names.get(m.user) ?? `Unknown person (${m.user})` }
          : { id: null, name: `${m.username ?? m.bot_profile?.name ?? "An app"} (app)` };
      const files = (m.files ?? []).map(
        (file) => `[File: ${file.title ?? file.name ?? "untitled"}]`,
      );
      const body = [plainText(text, (id) => names.get(id) ?? null), ...files]
        .filter((part) => part.trim() !== "")
        .join("\n");
      return { author, body };
    };
  };

  const channelName = async (channel: string) => {
    const parsed = info(await api("conversations.info", { channel }));
    if (!parsed.ok) throw new Error("slack: conversations.info: unexpected reply");
    return parsed.value.channel.name;
  };

  // A page's messages. One without a `ts` has no key and is skipped; odd
  // fields are left out. Either is logged.
  const messagesOf = (reply: unknown, method: string) => {
    const parsed = page(reply);
    if (!parsed.ok) throw new Error(`slack: ${method}: unexpected reply`);
    const found: Message[] = [];
    for (const raw of parsed.value.messages) {
      const taken = looseMessage(raw);
      if (!taken) log("slack: skipped a message Oriel can't place", { method });
      else found.push(taken.message);
      if (taken?.odd.length) log("slack: left out odd fields", { method, fields: taken.odd });
    }
    return { found, next: parsed.value.response_metadata?.next_cursor ?? "" };
  };

  return {
    kind: "slack",

    // One page per page of each channel's history, newest first. A channel
    // that can't be read throws, so the sync worker marks nothing gone.
    async *sync() {
      const named = people();
      for (const channel of channels) {
        const name = await channelName(channel);
        let cursor = "";
        let listed = 0;
        let oldest: string | null = null;
        let capped = false;
        do {
          const reply = await api("conversations.history", {
            channel,
            limit: pageSize,
            ...(cursor ? { cursor } : {}),
          });
          const { found, next } = messagesOf(reply, "conversations.history");
          // Replies sent to the channel too are listed here; they belong to
          // their message, which reads them.
          const roots = found.filter(isRoot);
          const records: SlackRecord[] = [];
          if (roots.length > cap - listed) capped = true;
          for (const m of roots.slice(0, cap - listed)) {
            oldest = m.ts;
            const { author, body } = await named(m);
            const times = [m.ts, m.latest_reply, m.edited?.ts].filter(
              (ts): ts is string => ts !== undefined && tsShape.test(ts),
            );
            const key = slackKey(channel, m.ts);
            records.push({
              id: itemId("slack", key),
              stableId: key,
              title: slackTitle(author.name, body),
              location: permalink(workspaceUrl, channel, m.ts),
              updatedAt: tsInstant(times.toSorted().at(-1) ?? m.ts),
              facets: slackFacets(),
              attrs: { channel: { id: channel, name }, author, replies: m.reply_count ?? 0 },
            });
          }
          listed += records.length;
          yield { records, gone: [], cursor: null };
          cursor = next;
          if (listed >= cap && cursor) capped = true;
          if (capped) break;
        } while (cursor);
        // What the sweep is about to mark gone mustn't read as fine.
        if (capped && oldest) {
          log("slack: the listing stopped at a cap", { channel, messages: listed });
          cutoff.set(channel, oldest);
        } else cutoff.delete(channel);
      }
    },

    // Each ID's message and replies, by `conversations.replies`. A message
    // in a channel the user didn't pick, or can't read now, is forbidden; one
    // that isn't there any more is deleted.
    async read(ids) {
      const named = people();
      const names = new Map<string, Promise<string | SlackError>>();
      const nameOf = (channel: string) => {
        let found = names.get(channel);
        if (!found) {
          found = channelName(channel).catch((error: unknown) => {
            if (error instanceof SlackError && forbidden.has(error.code)) return error;
            throw error;
          });
          names.set(channel, found);
        }
        return found;
      };
      const results: ReadResult<"slack", SlackContent>[] = [];
      for (const id of ids) {
        const parsed = parseItemId(id);
        const [channel = "", ts = ""] = parsed?.source === "slack" ? parsed.key.split("-") : [];
        const listed = channels.includes(channel) && ts >= (cutoff.get(channel) ?? "");
        const name = listed ? await nameOf(channel) : null;
        if (typeof name !== "string") {
          results.push({ id, status: "gone", reason: "forbidden" });
          continue;
        }
        const thread = await conversation(channel, ts).catch((error: unknown) => {
          if (error instanceof SlackError && deleted.has(error.code)) return "deleted" as const;
          if (error instanceof SlackError && forbidden.has(error.code)) return "forbidden" as const;
          throw error;
        });
        const root = typeof thread === "string" ? undefined : thread.find((m) => m.ts === ts);
        if (typeof thread === "string" || !isRoot(root)) {
          results.push({ id, status: "gone", reason: thread === "forbidden" ? thread : "deleted" });
          continue;
        }
        const { author, body } = await named(root);
        const replies = [];
        for (const reply of thread.filter((m) => m.ts !== ts && posted.has(m.subtype))) {
          const said = await named(reply);
          replies.push({ author: said.author, at: tsInstant(reply.ts), body: said.body });
        }
        const content = {
          channel: { id: channel, name },
          author,
          postedAt: tsInstant(ts),
          editedAt: root.edited && tsShape.test(root.edited.ts) ? tsInstant(root.edited.ts) : null,
          body,
          replies,
        };
        results.push({
          id,
          status: "ok",
          content: { ...content, title: slackTitle(author.name, body), text: slackText(content) },
        });
      }
      return results;
    },
  };

  // A message and its replies, oldest first, once each: Slack repeats the
  // message at the top of every page.
  async function conversation(channel: string, ts: string): Promise<Message[]> {
    const byTs = new Map<string, Message>();
    let cursor = "";
    do {
      const reply = await api("conversations.replies", {
        channel,
        ts,
        limit: pageSize,
        ...(cursor ? { cursor } : {}),
      });
      const { found, next } = messagesOf(reply, "conversations.replies");
      for (const m of found) byTs.set(m.ts, m);
      cursor = next;
      if (byTs.size > maxReplies && cursor) {
        log("slack: a message's replies stopped at a cap", { channel, replies: byTs.size - 1 });
        break;
      }
    } while (cursor);
    return [...byTs.values()].toSorted((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  }
}

// A message someone posted in the channel, not a reply to another.
function isRoot(m: Message | undefined): m is Message {
  return (
    m !== undefined &&
    posted.has(m.subtype) &&
    m.subtype !== "thread_broadcast" &&
    (m.thread_ts === undefined || m.thread_ts === m.ts)
  );
}
