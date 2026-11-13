// Slack's tools answer with Markdown meant for a model, with no option for structured content.
// https://docs.slack.dev/ai/slack-mcp-server/
import {
  answerText,
  type IndexRecord,
  narrowed,
  type SourceServer,
  ServerUnreadable,
  type ToolAnswer,
  type ToolCaller,
  WriteStalled,
} from "@oriel/core";
import { type ReadMethod, readMethods, type SlackApi, SlackError } from "./api.ts";
import {
  channelsOf,
  conciseAgrees,
  historyOf,
  justAfter,
  profileOf,
  searchedChannelsOf,
  threadOf,
} from "./slack-answers.ts";
import { slackAttrsOf } from "./attrs.ts";
import { maxChannels } from "./source.ts";

export const slackTools = {
  profile: "slack_read_user_profile",
  channels: "slack_list_user_channels",
  history: "slack_read_channel",
  thread: "slack_read_thread",
  search: "slack_search_channels",
  send: "slack_send_message",
} as const;

const t = slackTools;

// More tools need more scopes, not another address. Only `slack_search_channels` says which
// workspace it reads, in a channel's link.
export const slackServer: SourceServer = {
  name: "Slack's MCP server",
  reports: "Slack MCP",
  at: { url: "https://mcp.slack.com/mcp" },
  reads: [t.profile, t.channels, t.history, t.thread, t.search],
  writes: [t.send],
  instructions: "https://docs.slack.dev/ai/slack-mcp-server/",
  // By ID, so a renamed channel stays picked.
  picks: [
    {
      name: "channels",
      label: "Channels",
      many: true,
      most: maxChannels,
      unpicked: `your first ${maxChannels} channels`,
      unlisted:
        "You're not in this channel. Oriel reads it while Slack lets it; once Slack won't, syncing stops until you unpick it.",
      known: (records) => channelNames(records),
      async list(read, query, connection) {
        const api = slackServerReads({ read });
        const listed: { value: string; name: string }[] = [];
        const cursors = new Set<string>();
        let cursor = "";
        for (let page = 0; page < 10; page++) {
          const reply = (await api("conversations.list", {
            limit: "200",
            ...(cursor ? { cursor } : {}),
          })) as {
            channels: { id: string; name: string }[];
            response_metadata: { next_cursor: string };
          };
          for (const each of reply.channels) listed.push({ value: each.id, name: `#${each.name}` });
          cursor = reply.response_metadata.next_cursor;
          if (!cursor || cursors.has(cursor)) break;
          cursors.add(cursor);
        }
        const picked = Array.isArray(connection.options.channels)
          ? connection.options.channels.filter((each) => typeof each === "string")
          : [];
        return narrowed(listed, query, cursor ? [] : picked);
      },
    },
  ],
};

function* channelNames(records: readonly IndexRecord[]): Iterable<readonly [string, string]> {
  for (const record of records) {
    const attrs = slackAttrsOf(record);
    if (attrs) yield [attrs.channel.id, `#${attrs.channel.name}`];
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Any other failure stops a read, and a write that fails otherwise may have landed.
const known = new Set([
  "channel_not_found",
  "not_in_channel",
  "access_denied",
  "missing_scope",
  "no_permission",
  "thread_not_found",
  "message_not_found",
  "user_not_found",
  "is_archived",
  "msg_too_long",
  "restricted_action",
  "invalid_cursor",
  "ratelimited",
  "not_authed",
  "invalid_auth",
  "token_revoked",
  "missing_token",
  "invalid_token",
  "mcp_externally_shared_channel_restricted",
]);

// A failed tool names its code in words, such as "execution_failed: thread_not_found"; a
// lapsed sign-in may say so with no code at all.
function codeOf(words: string): string | null {
  for (const [code] of words.matchAll(/\b[a-z]+(?:_[a-z]+)*\b/g)) if (known.has(code)) return code;
  if (/\b(unauthori[sz]ed|not authenticated|sign(ed)? ?in)\b/i.test(words)) return "not_authed";
  if (/\b(rate limit|too many requests)\b/i.test(words)) return "ratelimited";
  return null;
}

function bodyOf(method: string, tool: string, answer: ToolAnswer, write: boolean): unknown {
  if (!isObject(answer) || !Array.isArray(answer.content))
    throw new ServerUnreadable(`${tool} answered with no content`);
  const words = answerText(answer);
  if (answer.isError === true) {
    const code = codeOf(words);
    if (code) throw new SlackError(method, code);
    if (write) throw new Error(`${tool} failed, and didn't say whether it posted`);
    throw new SlackError(method, "failed");
  }
  try {
    return JSON.parse(words) as unknown;
  } catch {
    if (write) return { text: words };
    throw new ServerUnreadable(`${tool} answered with text that isn't JSON`);
  }
}

// Only from `message_context` or `message_link`: the rest may repeat the text posted.
function postedTs(body: unknown, channel: string): string | undefined {
  if (!isObject(body)) return undefined;
  const context = isObject(body.message_context) ? body.message_context : {};
  const ts = context.message_ts;
  if (context.channel_id === channel && typeof ts === "string" && /^[0-9]{10}\.[0-9]{6}$/.test(ts))
    return ts;
  const link = typeof body.message_link === "string" ? body.message_link : "";
  const p =
    /^https:\/\/[a-z0-9-]+\.slack\.com\/archives\/([A-Z0-9]+)\/p([0-9]{10})([0-9]{6})$/.exec(link);
  return p && p[1] === channel ? `${p[2]}.${p[3]}` : undefined;
}

// Every mark that would make formatting, a link or a mention is escaped, so it posts as the
// plain text the person approved; `&`, `<` and `>` come escaped already (`escapeText`).
export const plainMarkdown = (text: string): string =>
  text
    .replace(/[\\`*_~[\]()!|@]/g, (mark) => `\\${mark}`)
    .replace(/^([ \t]*)([#=+-]|[0-9]+(?=[.)]))/gm, (_, space: string, mark: string) =>
      /^[0-9]/.test(mark) ? `${space}${mark}\\` : `${space}\\${mark}`,
    );

const most = { history: 100, thread: 1000, channels: 200 };
const limit = (asked: string | undefined, cap: number) =>
  Math.min(Math.max(Number(asked) || cap, 1), cap);

export type SlackServerOptions = {
  read: ToolCaller;
  write?: ToolCaller;
};

// Channel names are listed once until `forget`, which the source calls before each sync and
// read; a channel the person isn't in is named from its history's own heading.
export function slackServerApi(options: SlackServerOptions): SlackApi<string> & {
  forget(): void;
} {
  let listing: Promise<Map<string, string>> | null = null;

  const ask = async (method: string, tool: string, args: Record<string, unknown>) =>
    bodyOf(method, tool, await options.read({ tool, args }), false);

  const channels = async (method: string, params: Record<string, string>) => {
    const { channels: listed, next } = channelsOf(
      t.channels,
      await ask(method, t.channels, {
        types: "public_channel",
        limit: limit(params.limit, most.channels),
        ...(params.cursor ? { cursor: params.cursor } : {}),
      }),
    );
    return {
      ok: true,
      // The server lists archived ones too.
      channels: listed.filter((each) => !each.is_archived),
      response_metadata: { next_cursor: next },
    };
  };
  const names = () => {
    listing ??= (async () => {
      const all = new Map<string, string>();
      const cursors = new Set<string>();
      let cursor = "";
      do {
        const page = await channels("conversations.info", { cursor });
        for (const each of page.channels) all.set(each.id, each.name);
        cursor = page.response_metadata.next_cursor;
        if (cursors.has(cursor)) throw new ServerUnreadable(`${t.channels} repeated a page`);
        cursors.add(cursor);
      } while (cursor);
      return all;
    })();
    listing.catch(() => {
      listing = null;
    });
    return listing;
  };
  const history = async (method: string, channel: string, params: Record<string, unknown>) =>
    historyOf(t.history, await ask(method, t.history, { channel_id: channel, ...params }), channel);

  const api = async (method: string, params: Record<string, string>): Promise<unknown> => {
    switch (method) {
      case "auth.test": {
        // The profile doesn't say which workspace: the link of the first channel, found by name, does.
        const me = profileOf(t.profile, await ask(method, t.profile, {}));
        const first = [...(await names())][0];
        const found = first ? await searchChannel(options.read, first[1]) : [];
        const url = found.find((each) => each.id === first?.[0])?.workspace;
        if (!url)
          throw new ServerUnreadable(`${t.search} didn't say which Slack workspace it reads`);
        return { ok: true, url, team_id: "", user_id: me.id };
      }
      case "users.profile.get": {
        const them = profileOf(t.profile, await ask(method, t.profile, { user_id: params.user }));
        if (them.id !== params.user)
          throw new ServerUnreadable(`${t.profile} answered for another person`);
        return {
          ok: true,
          profile: { real_name: them.real_name, display_name: them.display_name },
        };
      }
      case "conversations.list":
        return channels(method, params);
      case "conversations.info": {
        const id = params.channel ?? "";
        const name = (await names()).get(id) ?? (await history(method, id, { limit: 1 })).name;
        return { ok: true, channel: { id, name } };
      }
      case "conversations.history": {
        const channel = params.channel ?? "";
        const page = await history(method, channel, {
          limit: limit(params.limit, most.history),
          ...(params.cursor ? { cursor: params.cursor } : {}),
        });
        // The same messages again, concise, which must agree with the
        // page's headers: a message's text can't make up another.
        const newest = page.messages[0]?.ts;
        if (newest)
          conciseAgrees(
            t.history,
            await ask(method, t.history, {
              channel_id: channel,
              latest: justAfter(newest),
              limit: Math.min(page.messages.length, most.history),
              response_format: "concise",
            }),
            channel,
            page.heads,
          );
        // A latest reply in a zone the page doesn't give, a clock change away: read its `ts` from the
        // thread, whose last page is its latest replies.
        const messages = await Promise.all(
          page.messages.map(async (each) => {
            if (!each.reply_count || each.latest_reply) return each;
            const thread = threadOf(
              t.thread,
              await ask(method, t.thread, { channel_id: channel, message_ts: each.ts, limit: 1 }),
              each.ts,
            );
            const latest = thread.messages.at(-1)?.ts;
            return latest && latest !== each.ts ? { ...each, latest_reply: latest } : each;
          }),
        );
        return { ok: true, messages, response_metadata: { next_cursor: page.next } };
      }
      case "conversations.replies": {
        const page = threadOf(
          t.thread,
          await ask(method, t.thread, {
            channel_id: params.channel,
            message_ts: params.ts,
            limit: limit(params.limit, most.thread),
            ...(params.cursor ? { cursor: params.cursor } : {}),
          }),
          params.ts ?? "",
        );
        return { ok: true, messages: page.messages, response_metadata: { next_cursor: page.next } };
      }
      case "chat.postMessage": {
        if (!options.write) throw new Error(`refusing a write on the read side: ${method}`);
        const args = {
          channel_id: params.channel,
          message: plainMarkdown(params.text ?? ""),
          ...(params.thread_ts ? { thread_ts: params.thread_ts } : {}),
        };
        const body = bodyOf(method, t.send, await options.write({ tool: t.send, args }), true);
        const ts = postedTs(body, params.channel ?? "");
        return { ok: true, channel: params.channel, ...(ts ? { ts } : {}) };
      }
      case "chat.delete":
        throw new WriteStalled("Slack's MCP server has no tool to delete a message");
      default:
        throw new Error(`Slack's MCP server has no tool to answer ${method}`);
    }
  };
  return Object.assign(api, {
    forget: () => {
      listing = null;
    },
  });
}

export async function searchChannel(
  read: ToolCaller,
  name: string,
): Promise<{ id: string; name: string; workspace: string }[]> {
  const answer = await read({
    tool: t.search,
    args: { keywords: [name], natural_language_query: "", limit: 20 },
  });
  const found = searchedChannelsOf(t.search, bodyOf("conversations.list", t.search, answer, false));
  return found.filter((each) => each.name === name);
}

// Read methods only, checked at run time too, so a cast can't send a write.
export function slackServerReads(
  options: Omit<SlackServerOptions, "write">,
): SlackApi<ReadMethod> & { forget(): void } {
  const api = slackServerApi(options);
  const reads = async (method: ReadMethod, params: Record<string, string>) => {
    if (!(readMethods as readonly string[]).includes(method))
      throw new Error(`refusing a method the read side doesn't use: ${method}`);
    return api(method, params);
  };
  return Object.assign(reads, { forget: api.forget });
}
