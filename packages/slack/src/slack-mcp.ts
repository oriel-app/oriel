// Slack through Slack's own MCP server (decision 0059, OA-277): the entry
// Oriel knows it by, and the parser, both ways. The parser is a `SlackApi`:
// each Web API call the source, its connect and the writer make becomes one
// call of the server's tools, and the tool's answer becomes the Web API's
// body they already check, so everything they do works the same through it.
// A call with no tool to answer it is refused before anything is sent.
//
// Slack documents its tools' names and arguments, not their answers. Where
// it doesn't show an answer's shape, this reads the Web API's shape the tool
// wraps, under the names its documented answers use, and anything else it
// can't read stops the sync, naming the server (`ServerUnreadable`): the
// index stays as it was. packages/standin-mcp/README.md lists what's assumed.
// https://docs.slack.dev/ai/slack-mcp-server/
import {
  answerJson,
  answerText,
  type SourceServer,
  ServerUnreadable,
  type ToolAnswer,
  type ToolCaller,
  WriteStalled,
} from "@oriel/core";
import { type ReadMethod, readMethods, type SlackApi, SlackError } from "./api.ts";

// Its tools Oriel calls, by what each does.
export const slackTools = {
  profile: "slack_read_user_profile",
  channels: "slack_list_user_channels",
  history: "slack_read_channel",
  thread: "slack_read_thread",
  send: "slack_send_message",
} as const;

const t = slackTools;

// Slack's MCP server, as Oriel knows it, by its address: its default
// tools, ours among them, are all listed there; more need more scopes, not
// another address.
export const slackServer: SourceServer = {
  name: "Slack's MCP server",
  reports: "Slack MCP",
  at: { url: "https://mcp.slack.com/mcp" },
  reads: [t.profile, t.channels, t.history, t.thread],
  writes: [t.send],
  instructions: "https://docs.slack.dev/ai/slack-mcp-server/",
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" ? value : undefined);

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

// The code a failed tool's words name, if one Oriel knows. A sign-in that
// lapsed may say so in words, not a code.
function codeOf(words: string): string | null {
  for (const [code] of words.matchAll(/\b[a-z]+(?:_[a-z]+)*\b/g)) if (known.has(code)) return code;
  if (/\b(unauthori[sz]ed|not authenticated|sign(ed)? ?in)\b/i.test(words)) return "not_authed";
  if (/\b(rate limit|too many requests)\b/i.test(words)) return "ratelimited";
  return null;
}

// A tool's answer as JSON, or, for a failed one, Slack's error for it: as
// the Web API answers `ok: false`. A read that failed for a reason it
// doesn't name stops; a write that did may have landed, so it's no refusal.
function bodyOf(method: string, tool: string, answer: ToolAnswer, write: boolean): unknown {
  if (!isObject(answer) || !Array.isArray(answer.content))
    throw new ServerUnreadable(`${tool} answered with no content`);
  if (answer.isError === true) {
    const code = codeOf(answerText(answer));
    if (code) throw new SlackError(method, code);
    if (write) throw new Error(`${tool} failed, and didn't say whether it posted`);
    throw new SlackError(method, "failed");
  }
  return answerJson(tool, answer);
}

// A list an answer gives as itself or under `key`.
function listOf(tool: string, body: unknown, key: string): unknown[] {
  if (Array.isArray(body)) return body;
  if (isObject(body) && Array.isArray(body[key])) return body[key] as unknown[];
  throw new ServerUnreadable(`${tool} answered with no ${key}`);
}

// The cursor to an answer's next page, or "" on the last: Slack's
// `response_metadata.next_cursor`, or a `next_cursor` beside its list. One
// that says more remain but gives no way to them can't be read: a sweep
// that stopped there would take the rest away.
function nextOf(tool: string, body: unknown): string {
  if (!isObject(body)) return "";
  const meta = isObject(body.response_metadata) ? body.response_metadata : {};
  const given = meta.next_cursor ?? body.next_cursor;
  if (given !== undefined && given !== null && typeof given !== "string")
    throw new ServerUnreadable(`${tool} gave a cursor Oriel can't read`);
  const cursor = given ?? "";
  if (cursor === "" && body.has_more === true)
    throw new ServerUnreadable(`${tool} said more remain, with no way to them`);
  return cursor;
}

// A message as the Web API gives it, under the names Slack's tools answer
// with where those differ (`message_ts`, `user_id`). What it holds is the
// source's to check.
function messageOf(tool: string, raw: unknown): unknown {
  if (!isObject(raw)) throw new ServerUnreadable(`${tool} listed a message that isn't one`);
  const { message_ts, user_id, ...rest } = raw;
  return {
    ...(message_ts !== undefined && rest.ts === undefined ? { ts: message_ts } : {}),
    ...(user_id !== undefined && rest.user === undefined ? { user: user_id } : {}),
    ...rest,
  };
}

// A person's profile, flat or under `profile` or `user`, and who they are.
function profileOf(tool: string, body: unknown) {
  if (!isObject(body)) throw new ServerUnreadable(`${tool} answered with no profile`);
  const user = isObject(body.user) ? body.user : {};
  const profile = isObject(body.profile)
    ? body.profile
    : isObject(user.profile)
      ? user.profile
      : { ...user, ...body };
  return {
    id: text(body.user_id) ?? text(body.id) ?? text(user.id),
    team: text(body.team_id) ?? text(user.team_id) ?? "",
    url: text(body.workspace_url) ?? text(body.team_url) ?? text(body.url),
    real_name: text(profile.real_name),
    display_name: text(profile.display_name),
  };
}

// A workspace's address as `auth.test` gives one, such as
// "https://example.slack.com/": only one of Slack's own, as items link
// into it.
function workspaceOf(url: string | undefined): string {
  const parsed = url && URL.canParse(url) ? new URL(url) : null;
  if (parsed?.protocol !== "https:" || !parsed.hostname.endsWith(".slack.com"))
    throw new ServerUnreadable(`${t.profile} didn't say which Slack workspace it reads`);
  return `${parsed.origin}/`;
}

// A posted message's `ts`, as the answer gives it, or from its link.
function postedTs(body: unknown): string | undefined {
  if (!isObject(body)) return undefined;
  const context = isObject(body.message_context) ? body.message_context : {};
  const message = isObject(body.message) ? body.message : {};
  const given = text(context.message_ts) ?? text(body.ts) ?? text(message.ts);
  if (given) return given;
  const link = text(body.message_link) ?? text(body.permalink);
  const p = link ? /\/p([0-9]{10})([0-9]{6})(?:[?#]|$)/.exec(link) : null;
  return p ? `${p[1]}.${p[2]}` : undefined;
}

// The most a page asks of each listing tool, as Slack's docs give them.
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
// calls before each sync and read, so a renamed one shows on the next.
export function slackServerApi(options: SlackServerOptions): SlackApi<string> & {
  forget(): void;
} {
  let listing: Promise<Map<string, string>> | null = null;

  const ask = async (method: string, tool: string, args: Record<string, unknown>) =>
    bodyOf(method, tool, await options.read({ tool, args }), false);

  // One page of the person's public channels, as `conversations.list`.
  const channels = async (method: string, params: Record<string, string>) => {
    const body = await ask(method, t.channels, {
      channel_types: "public_channel",
      limit: limit(params.limit, most.channels),
      ...(params.cursor ? { cursor: params.cursor } : {}),
    });
    const listed = listOf(t.channels, body, "channels").map((each) => {
      if (!isObject(each) || typeof each.id !== "string" || typeof each.name !== "string")
        throw new ServerUnreadable(`${t.channels} listed a channel without its ID and name`);
      return { id: each.id, name: each.name, is_archived: each.is_archived === true };
    });
    return {
      ok: true,
      // Archived ones are listed too, unless asked not to.
      channels: listed.filter((each) => !each.is_archived),
      response_metadata: { next_cursor: nextOf(t.channels, body) },
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
  // A page of messages, as `conversations.history` and `.replies` answer.
  const page = (tool: string, body: unknown) => ({
    ok: true,
    messages: listOf(tool, body, "messages").map((each) => messageOf(tool, each)),
    response_metadata: { next_cursor: nextOf(tool, body) },
  });

  const api = async (method: string, params: Record<string, string>): Promise<unknown> => {
    switch (method) {
      case "auth.test": {
        const me = profileOf(t.profile, await ask(method, t.profile, {}));
        if (!me.id) throw new ServerUnreadable(`${t.profile} didn't say who you are`);
        return { ok: true, url: workspaceOf(me.url), team_id: me.team, user_id: me.id };
      }
      case "users.profile.get": {
        const them = profileOf(t.profile, await ask(method, t.profile, { user_id: params.user }));
        return {
          ok: true,
          profile: {
            ...(them.real_name === undefined ? {} : { real_name: them.real_name }),
            ...(them.display_name === undefined ? {} : { display_name: them.display_name }),
          },
        };
      }
      case "conversations.list":
        return channels(method, params);
      case "conversations.info": {
        const id = params.channel ?? "";
        const name = (await names()).get(id);
        if (name === undefined) throw new SlackError(method, "channel_not_found");
        return { ok: true, channel: { id, name } };
      }
      case "conversations.history":
        return page(
          t.history,
          await ask(method, t.history, {
            channel_id: params.channel,
            limit: limit(params.limit, most.history),
            ...(params.cursor ? { cursor: params.cursor } : {}),
          }),
        );
      case "conversations.replies":
        return page(
          t.thread,
          await ask(method, t.thread, {
            channel_id: params.channel,
            message_ts: params.ts,
            limit: limit(params.limit, most.thread),
            ...(params.cursor ? { cursor: params.cursor } : {}),
          }),
        );
      case "chat.postMessage": {
        if (!options.write) throw new Error(`refusing a write on the read side: ${method}`);
        const args = {
          channel_id: params.channel,
          message: params.text,
          ...(params.thread_ts ? { thread_ts: params.thread_ts } : {}),
        };
        const body = bodyOf(method, t.send, await options.write({ tool: t.send, args }), true);
        const ts = postedTs(body);
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
