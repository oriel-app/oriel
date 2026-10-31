// The Slack fixture's shape, and the Web API as the fixture answers it, for
// unit tests and evals. The fixture is a workspace written down: its people,
// its channels and each channel's messages, with replies under their
// message. The fake answers the read methods the source calls, in Slack's
// shapes, as the Web API reference documents them: history newest first
// without replies, except those sent to the channel too; replies with their
// message at the top of every page; pages by cursor; and Slack's error codes
// for what isn't there. All names and content are made up.
import {
  array,
  boolean,
  type Issue,
  object,
  optional,
  refine,
  type Result,
  string,
  type Validator,
} from "@oriel/core";
import { type ReadMethod, type SlackApi, SlackError } from "./api.ts";

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
};

export type FixtureCall = { method: ReadMethod; params: Record<string, string> };

export function fixtureApi(fixture: SlackFixture, options: FixtureApiOptions = {}) {
  const calls: FixtureCall[] = [];
  const most = Math.max(Math.trunc(options.pageSize ?? 1000), 1);
  const channels = new Map(fixture.channels.map((channel) => [channel.id, channel]));
  const users = new Map(fixture.users.map((user) => [user.id, user]));

  const paged = (
    method: ReadMethod,
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

  const channelOf = (method: ReadMethod, params: Record<string, string>) => {
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

  const api: SlackApi = async (method, params) => {
    calls.push({ method, params: { ...params } });
    switch (method) {
      case "auth.test":
        return {
          ok: true,
          url: fixture.team.url,
          team_id: fixture.team.id,
          user_id: fixture.users[0]?.id,
        };
      case "conversations.list": {
        const all = fixture.channels.map((c) => ({ id: c.id, name: c.name, is_archived: false }));
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
  return { api, calls };
}
