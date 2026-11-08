// Slack through Slack's own MCP server (decision 0059, OA-277): the entry
// Oriel knows it by, and the parser, both ways. The parser is a `SlackApi`:
// each Web API call the source, its connect and the writer make becomes one
// call of the server's tools, and the tool's answer becomes the Web API's
// body they already check, so everything they do works the same through it.
// A call with no tool to answer it is refused before anything is sent.
//
// Slack's tools answer with Markdown meant for a model, under a key of a
// JSON object, with no structured content and no option for any. Each
// tool's answer is read by its own reader (`slack-answers.ts`), and
// anything it doesn't recognise stops the sync, naming the server
// (`ServerUnreadable`): the index stays as it was.
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

// Its tools Oriel calls, by what each does.
export const slackTools = {
  profile: "slack_read_user_profile",
  channels: "slack_list_user_channels",
  history: "slack_read_channel",
  thread: "slack_read_thread",
  search: "slack_search_channels",
  send: "slack_send_message",
} as const;

const t = slackTools;

// Slack's MCP server, as Oriel knows it, by its address: its default
// tools, ours among them, are all listed there; more need more scopes, not
// another address. `slack_search_channels` gives a channel's link, which
// is the only place it says which workspace it reads.
export const slackServer: SourceServer = {
  name: "Slack's MCP server",
  reports: "Slack MCP",
  at: { url: "https://mcp.slack.com/mcp" },
  reads: [t.profile, t.channels, t.history, t.thread, t.search],
  writes: [t.send],
  instructions: "https://docs.slack.dev/ai/slack-mcp-server/",
  // The channels a connection reads, from those the person is in, as the
  // server lists them, by ID, so a renamed one stays picked.
  picks: [
    {
      name: "channels",
      label: "Channels",
      many: true,
      most: maxChannels,
      unpicked: `your first ${maxChannels} channels`,
      // A picked channel the person isn't in. Oriel reads it as long as
      // Slack lets it; once Slack won't, a sync stops, keeping the window
      // as it was, and the connection waits when it opens again
      // (`serverProblem`, `openThrough`).
      unlisted:
        "You're not in this channel. Oriel reads it while Slack lets it; once Slack won't, syncing stops until you unpick it.",
      known: (records) => channelNames(records),
      async list(read, query, connection) {
        const api = slackServerReads({ read });
        const listed: { value: string; name: string }[] = [];
        const cursors = new Set<string>();
        let cursor = "";
        // At most 10 pages, of 200 each.
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
        // Only a whole list says a picked channel isn't among them.
        const picked = Array.isArray(connection.options.channels)
          ? connection.options.channels.filter((each) => typeof each === "string")
          : [];
        return narrowed(listed, query, cursor ? [] : picked);
      },
    },
  ],
};

// The names of the channels indexed messages are in, by ID, as `#name`.
function* channelNames(records: readonly IndexRecord[]): Iterable<readonly [string, string]> {
  for (const record of records) {
    const attrs = slackAttrsOf(record);
    if (attrs) yield [attrs.channel.id, `#${attrs.channel.name}`];
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Slack's error codes the source and the writer act on, as a failed tool
// names them. Any other failure of a read stops it; of a write, may have
// landed.
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

// The code a failed tool's words name, if one Oriel knows, such as
// "execution_failed: thread_not_found". A sign-in that lapsed may say so in
// words, not a code.
function codeOf(words: string): string | null {
  for (const [code] of words.matchAll(/\b[a-z]+(?:_[a-z]+)*\b/g)) if (known.has(code)) return code;
  if (/\b(unauthori[sz]ed|not authenticated|sign(ed)? ?in)\b/i.test(words)) return "not_authed";
  if (/\b(rate limit|too many requests)\b/i.test(words)) return "ratelimited";
  return null;
}

// A tool's answer as its JSON object, or, for a failed one, Slack's error
// for it: as the Web API answers `ok: false`. A read that failed for a
// reason it doesn't name stops; a write that did may have landed, so it's
// no refusal.
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
    // A write's answer is read for its message's link, if it gives one.
    if (write) return { text: words };
    throw new ServerUnreadable(`${tool} answered with text that isn't JSON`);
  }
}

// A posted message's `ts`, as Slack's send tool answers: its
// `message_context`, in the channel posted to, or else its `message_link`
// there. Nothing else in the answer, which may repeat the text posted.
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

// A message's text as Slack's send tool takes it, in markdown: every mark
// that would make formatting, a link or a mention escaped with a
// backslash, inline and at a line's start, so it posts as the plain text
// the person approved, as the Web API's `mrkdwn: false` does. `&`, `<` and
// `>` come escaped already (`escapeText`).
export const plainMarkdown = (text: string): string =>
  text
    .replace(/[\\`*_~[\]()!|@]/g, (mark) => `\\${mark}`)
    .replace(/^([ \t]*)([#=+-]|[0-9]+(?=[.)]))/gm, (_, space: string, mark: string) =>
      /^[0-9]/.test(mark) ? `${space}${mark}\\` : `${space}\\${mark}`,
    );

// The most a page asks of each listing tool, as Slack's tools give them.
const most = { history: 100, thread: 1000, channels: 200 };
const limit = (asked: string | undefined, cap: number) =>
  Math.min(Math.max(Number(asked) || cap, 1), cap);

export type SlackServerOptions = {
  read: ToolCaller;
  // A change set's replay; absent on the read side.
  write?: ToolCaller;
};

// The Web API answered through Slack's server: reads through `read`, a
// post through `write`. A channel's name comes from the person's channels
// as the server lists them, listed once until `forget`, which the source
// calls before each sync and read, so a renamed one shows on the next; one
// they aren't in, from its history's own heading.
export function slackServerApi(options: SlackServerOptions): SlackApi<string> & {
  forget(): void;
} {
  let listing: Promise<Map<string, string>> | null = null;

  const ask = async (method: string, tool: string, args: Record<string, unknown>) =>
    bodyOf(method, tool, await options.read({ tool, args }), false);

  // One page of the person's public channels, as `conversations.list`.
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
      // Archived ones are listed too, unless asked not to.
      channels: listed.filter((each) => !each.is_archived),
      response_metadata: { next_cursor: next },
    };
  };
  // Every channel's name, by its ID, page by page.
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
  // A channel's history, one page, as the server lists it.
  const history = async (method: string, channel: string, params: Record<string, unknown>) =>
    historyOf(t.history, await ask(method, t.history, { channel_id: channel, ...params }), channel);

  const api = async (method: string, params: Record<string, string>): Promise<unknown> => {
    switch (method) {
      case "auth.test": {
        // Who the person is, from their profile; which workspace, from the
        // link of the first channel they're in, as the server finds it by
        // name: the profile doesn't say.
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
        // A thread whose latest reply is in a zone the page doesn't give, a
        // clock change away: its latest reply's own `ts`, from the thread,
        // whose last page is its latest replies.
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
        // Nothing is sent: Revert can't undo a post through the server.
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

// Public channels named `name`, with the workspace each is in, as the
// server's search finds them: exactly that name, never one like it.
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

// The read side of it: no writer, and read methods only, checked at run
// time too, as `webApi` checks them.
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
