// Connecting Slack: the workspace a token is for, and the channels the user
// picked, by name or ID, found among the public channels it can see. A
// channel that isn't found is reported, never guessed at.
import { array, boolean, object, optional, string } from "@oriel/core";
import type { SlackApi } from "./api.ts";

const auth = object({ url: string, team_id: string });
const listing = object({
  channels: array(object({ id: string, name: string, is_archived: optional(boolean) })),
  response_metadata: optional(object({ next_cursor: optional(string) })),
});

export type SlackWorkspace = {
  teamId: string;
  // Its address, such as "https://example.slack.com/".
  url: string;
  channels: { id: string; name: string }[];
  // What the user asked for that isn't one of its public channels.
  missing: string[];
};

export async function connectSlack(
  api: SlackApi,
  picked: readonly string[],
): Promise<SlackWorkspace> {
  const who = auth(await api("auth.test", {}));
  if (!who.ok) throw new Error("slack: auth.test: unexpected reply");
  const wanted = picked.map((name) => name.trim().replace(/^#/, "")).filter(Boolean);
  const found = new Map<string, { id: string; name: string }>();
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
    for (const channel of reply.value.channels)
      for (const want of wanted)
        if (want === channel.id || want === channel.name)
          found.set(want, { id: channel.id, name: channel.name });
    cursor = reply.value.response_metadata?.next_cursor ?? "";
  } while (cursor && found.size < wanted.length);
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
  };
}
