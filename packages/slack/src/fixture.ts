// The Slack fixture's shape, and the Web API as the fixture answers it, for
// unit tests, evals and the dev server's synthetic workspace. The fixture is a workspace written down: its people,
// its channels and each channel's messages, with replies under their
// message. The fake answers the read methods the source calls, in Slack's
// shapes, as the Web API reference documents them: history newest first
// without replies, except those sent to the channel too; replies with their
// message at the top of every page; pages by cursor; and Slack's error codes
// for what isn't there. All names and content are made up.
//
// It writes too, to its own copy of the workspace, never the fixture: a post
// or a reply by the person `auth.test` names (the fixture's first), and a
// delete of their own message, as Slack answers `chat.postMessage` and
// `chat.delete` for a user token. Its `fetch` answers each method at
// slack.com's address, so the writer reaches it as it reaches Slack. Others'
// edits and replies (`edit`, `replyAs`) are for tests of what a revert finds.
import {
  array,
  boolean,
  type Instant,
  type Issue,
  object,
  optional,
  refine,
  type Result,
  string,
  type Validator,
} from "@oriel/core";
import { type ReadMethod, readMethods, type SlackApi, SlackError } from "./api.ts";

const ts = refine(string, (value) => /^[0-9]{10}\.[0-9]{6}$/.test(value), "expected a Slack ts");

const fields = {
  ts,
  // The person who posted it; absent for an app that posted as itself.
  user: optional(string),
  text: string,
  subtype: optional(string),
  // Set when an app posted it, for a person (with `user`) or as itself.
  bot_id: optional(string),
  app_id: optional(string),
  username: optional(string),
  edited: optional(object({ user: string, ts })),
  files: optional(array(object({ name: string, title: optional(string) }))),
};

const reply = object(fields);
const fixtureMessage = object({ ...fields, replies: optional(array(reply)) });

const slackFixtureShape: Validator<SlackFixture> = object({
  team: object({ id: string, url: string }),
  // The channels the user picked; the others prove nothing else is read.
  picked: array(string),
  users: array(
    object({ id: string, real_name: string, display_name: string, deleted: optional(boolean) }),
  ),
  channels: array(object({ id: string, name: string, messages: array(fixtureMessage) })),
});

export type FixtureReply = {
  ts: string;
  user?: string;
  text: string;
  subtype?: string;
  bot_id?: string;
  app_id?: string;
  username?: string;
  edited?: { user: string; ts: string };
  files?: { name: string; title?: string }[];
};
export type FixtureMessage = FixtureReply & { replies?: FixtureReply[] };
export type SlackFixture = {
  team: { id: string; url: string };
  picked: string[];
  users: { id: string; real_name: string; display_name: string; deleted?: boolean }[];
  channels: { id: string; name: string; messages: FixtureMessage[] }[];
};

// The shape, then what Slack itself guarantees: a `ts` is unique in its
// channel, replies come after their message, and picked channels exist.
export function parseSlackFixture(input: unknown): Result<SlackFixture> {
  const shaped = slackFixtureShape(input);
  if (!shaped.ok) return shaped;
  const fixture = shaped.value;
  const issues: Issue[] = [];
  const ids = new Set(fixture.channels.map((channel) => channel.id));
  fixture.picked.forEach((id, i) => {
    if (!ids.has(id)) issues.push({ path: `$.picked[${i}]`, message: "no such channel" });
  });
  fixture.channels.forEach((channel, c) => {
    const seen = new Set<string>();
    channel.messages.forEach((m, i) => {
      for (const [at, posted] of [
        [`${i}`, m] as const,
        ...(m.replies ?? []).map((r, j) => [`${i}].replies[${j}`, r] as const),
      ]) {
        const path = `$.channels[${c}].messages[${at}]`;
        if (seen.has(posted.ts)) issues.push({ path, message: "a ts used twice in the channel" });
        seen.add(posted.ts);
        if (posted !== m && posted.ts <= m.ts)
          issues.push({ path, message: "a reply must come after its message" });
      }
    });
  });
  return issues.length ? { ok: false, issues } : shaped;
}

export type FixtureApiOptions = {
  // The most a page holds, whatever the caller asks for, so tests can make
  // the source follow cursors.
  pageSize?: number;
  // When a post lands; without it, a second after the workspace's latest
  // message, so tests read no clock.
  now?: () => Instant;
};

export type FixtureCall = { method: string; params: Record<string, string> };

// Where the fake answers, as Slack's Web API does.
export const fixtureApiOrigin = "https://slack.com";

export type FixtureWorkspace = ReturnType<typeof fixtureApi>;

export function fixtureApi(fixture: SlackFixture, options: FixtureApiOptions = {}) {
  const calls: FixtureCall[] = [];
  const most = Math.max(Math.trunc(options.pageSize ?? 1000), 1);
  const copy = structuredClone(fixture);
  const channels = new Map(copy.channels.map((channel) => [channel.id, channel]));
  const users = new Map(copy.users.map((user) => [user.id, user]));
  // Who the token is for.
  const self = copy.users[0]?.id;

  const paged = (
    method: string,
    params: Record<string, string>,
    all: unknown[],
    pinned?: unknown,
  ) => {
    const size = Math.min(Number(params.limit) || 100, most);
    const at = params.cursor ? Number(/^at:([0-9]+)$/.exec(params.cursor)?.[1] ?? Number.NaN) : 0;
    if (!Number.isInteger(at)) throw new SlackError(method, "invalid_cursor");
    const end = at + size;
    const messages = all.slice(at, end);
    return {
      ok: true,
      messages: pinned === undefined || at === 0 ? messages : [pinned, ...messages],
      has_more: end < all.length,
      response_metadata: { next_cursor: end < all.length ? `at:${end}` : "" },
    };
  };

  const channelOf = (method: string, params: Record<string, string>) => {
    const channel = channels.get(params.channel ?? "");
    if (!channel) throw new SlackError(method, "channel_not_found");
    return channel;
  };

  // A message as history lists it: its replies summed up, not included.
  const listed = (m: FixtureMessage) => {
    const { replies = [], ...rest } = m;
    if (!replies.length) return structuredClone(rest);
    return {
      ...structuredClone(rest),
      thread_ts: m.ts,
      reply_count: replies.length,
      reply_users_count: new Set(replies.map((r) => r.user ?? r.bot_id)).size,
      latest_reply: replies.at(-1)?.ts,
    };
  };

  // The next `ts`: a second after the latest in the workspace, or now if
  // that is later.
  const nextTs = (): string => {
    const all = copy.channels.flatMap((c) =>
      c.messages.flatMap((m) => [m.ts, ...(m.replies ?? []).map((r) => r.ts)]),
    );
    const latest = Math.max(0, ...all.map((ts) => Number(ts.split(".")[0])));
    const at = options.now ? Math.floor(Date.parse(options.now()) / 1000) : 0;
    return `${Math.max(latest + 1, at)}.000100`;
  };
  const find = (method: string, params: Record<string, string>) => {
    const channel = channelOf(method, params);
    const ts = params.ts ?? "";
    const root = channel.messages.find((m) => m.ts === ts);
    const parent = channel.messages.find((m) => (m.replies ?? []).some((r) => r.ts === ts));
    const reply = parent?.replies?.find((r) => r.ts === ts);
    return { channel, root, parent, reply };
  };

  const answer = async (method: string, params: Record<string, string>): Promise<unknown> => {
    calls.push({ method, params: { ...params } });
    switch (method) {
      case "chat.postMessage": {
        const channel = channelOf(method, params);
        if (!self) throw new SlackError(method, "not_authed");
        const text = params.text ?? "";
        if (!text.trim()) throw new SlackError(method, "no_text");
        const posted: FixtureReply = { ts: nextTs(), user: self, text };
        const thread = params.thread_ts;
        if (thread) {
          const root = channel.messages.find((m) => m.ts === thread);
          if (!root) throw new SlackError(method, "thread_not_found");
          root.replies = [...(root.replies ?? []), posted];
        } else channel.messages.push(posted);
        return { ok: true, channel: channel.id, ts: posted.ts, message: { ...posted } };
      }
      case "chat.delete": {
        const { channel, root, parent, reply } = find(method, params);
        const found = root ?? reply;
        if (!found) throw new SlackError(method, "message_not_found");
        if (found.user !== self) throw new SlackError(method, "cant_delete_message");
        if (reply && parent)
          parent.replies = (parent.replies ?? []).filter((r) => r.ts !== reply.ts);
        else if (root?.replies?.length)
          // A message with replies leaves a placeholder over them.
          Object.assign(root, {
            user: "USLACKBOT",
            subtype: "tombstone",
            text: "This message was deleted.",
          });
        else channel.messages = channel.messages.filter((m) => m.ts !== found.ts);
        return { ok: true, channel: channel.id, ts: found.ts };
      }
      default:
        if (!(readMethods as readonly string[]).includes(method))
          throw new SlackError(method, "unknown_method");
        return read(method as ReadMethod, params);
    }
  };

  const read = async (method: ReadMethod, params: Record<string, string>): Promise<unknown> => {
    switch (method) {
      case "auth.test":
        return {
          ok: true,
          url: copy.team.url,
          team_id: copy.team.id,
          user_id: self,
        };
      case "conversations.list": {
        const all = copy.channels.map((c) => ({ id: c.id, name: c.name, is_archived: false }));
        const { messages, ...rest } = paged(method, params, all);
        return { ...rest, channels: messages };
      }
      case "conversations.info": {
        const channel = channelOf(method, params);
        return { ok: true, channel: { id: channel.id, name: channel.name } };
      }
      case "conversations.history": {
        const channel = channelOf(method, params);
        const all = channel.messages
          .flatMap((m) => [
            listed(m),
            ...(m.replies ?? [])
              .filter((r) => r.subtype === "thread_broadcast")
              .map((r) => ({ ...structuredClone(r), thread_ts: m.ts })),
          ])
          .toSorted((a, b) => (a.ts < b.ts ? 1 : -1));
        return paged(method, params, all);
      }
      case "conversations.replies": {
        const channel = channelOf(method, params);
        const root = channel.messages.find((m) => m.ts === params.ts);
        if (!root) {
          const lone = channel.messages
            .flatMap((m) => (m.replies ?? []).map((r) => ({ ...r, thread_ts: m.ts })))
            .find((r) => r.ts === params.ts);
          if (!lone) throw new SlackError(method, "thread_not_found");
          return paged(method, params, [structuredClone(lone)]);
        }
        const replies = (root.replies ?? []).map((r) => ({
          ...structuredClone(r),
          thread_ts: root.ts,
        }));
        return paged(method, params, [listed(root), ...replies], listed(root));
      }
      case "users.profile.get": {
        const user = users.get(params.user ?? "");
        if (!user) throw new SlackError(method, "user_not_found");
        return {
          ok: true,
          profile: { real_name: user.real_name, display_name: user.display_name },
        };
      }
    }
  };
  const api: SlackApi = (method, params) => answer(method, params);

  // Slack's Web API at its own address, for any method, reads and writes:
  // a form body in, Slack's JSON out, and `ok: false` with its code for what
  // it refuses.
  const fetchApi = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = url.pathname.replace(/^\/api\//, "");
    if (url.origin !== fixtureApiOrigin || method === url.pathname)
      return new Response("not found", { status: 404 });
    const params = Object.fromEntries(new URLSearchParams(String(init?.body ?? "")));
    try {
      return Response.json(await answer(method, params));
    } catch (error) {
      if (error instanceof SlackError) return Response.json({ ok: false, error: error.code });
      throw error;
    }
  };

  return {
    api,
    calls,
    fetch: fetchApi as typeof fetch,
    // Someone else edits a message or reply, as Slack marks an edit.
    edit(channel: string, ts: string, text: string, by: string) {
      const { root, reply } = find("edit", { channel, ts });
      const found = root ?? reply;
      if (!found) throw new Error(`no message ${ts} in ${channel}`);
      Object.assign(found, { text, edited: { user: by, ts: nextTs() } });
    },
    // Someone else replies in a conversation.
    replyAs(by: string, channel: string, thread: string, text: string) {
      const root = channelOf("replyAs", { channel }).messages.find((m) => m.ts === thread);
      if (!root) throw new Error(`no message ${thread} in ${channel}`);
      const ts = nextTs();
      root.replies = [...(root.replies ?? []), { ts, user: by, text }];
      return ts;
    },
  };
}
