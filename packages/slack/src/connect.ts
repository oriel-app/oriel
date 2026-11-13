import { array, boolean, object, optional, string } from "@oriel/core";
import type { SlackApi } from "./api.ts";

const auth = object({ url: string, team_id: string, user_id: optional(string) });
const listing = object({
  channels: array(object({ id: string, name: string, is_archived: optional(boolean) })),
  response_metadata: optional(object({ next_cursor: optional(string) })),
});

export type SlackWorkspace = {
  teamId: string;
  url: string;
  channels: { id: string; name: string }[];
  missing: string[];
  self: string | null;
};

// Slack's MCP server lists only the channels the person is in, so with none picked, `firstOf`
// takes the first of those.
export async function connectSlack(
  api: SlackApi,
  picked: readonly string[],
  firstOf?: number,
): Promise<SlackWorkspace> {
  const who = auth(await api("auth.test", {}));
  if (!who.ok) throw new Error("slack: auth.test: unexpected reply");
  const wanted = picked.map((name) => name.trim().replace(/^#/, "")).filter(Boolean);
  const found = new Map<string, { id: string; name: string }>();
  const take = wanted.length === 0 ? (firstOf ?? 0) : 0;
  let cursor = "";
  do {
    const reply = listing(
      await api("conversations.list", {
        types: "public_channel",
        exclude_archived: "true",
        limit: "200",
        ...(cursor ? { cursor } : {}),
      }),
    );
    if (!reply.ok) throw new Error("slack: conversations.list: unexpected reply");
    for (const channel of reply.value.channels) {
      if (found.size < take) {
        wanted.push(channel.id);
        found.set(channel.id, { id: channel.id, name: channel.name });
      }
      for (const want of wanted)
        if (want === channel.id || want === channel.name)
          found.set(want, { id: channel.id, name: channel.name });
    }
    cursor = reply.value.response_metadata?.next_cursor ?? "";
  } while (cursor && (take ? found.size < take : found.size < wanted.length));
  const channels = [
    ...new Map(
      wanted.flatMap((want) => {
        const channel = found.get(want);
        return channel ? [[channel.id, channel] as const] : [];
      }),
    ).values(),
  ];
  return {
    teamId: who.value.team_id,
    url: who.value.url,
    channels,
    missing: wanted.filter((want) => !found.has(want)),
    self: who.value.user_id ?? null,
  };
}

export async function slackPerson(api: SlackApi): Promise<string> {
  const who = object({ user_id: string })(await api("auth.test", {}));
  if (!who.ok) throw new Error("slack: auth.test: unexpected reply");
  return who.value.user_id;
}
