// What the agent reads to draft a Slack connection's channels, while it
// waits for its options (decision 0051): the public channels the workspace
// lists, each by name with the day it was last active, most lately active
// first, read live. Only the fixture's workspace in memory waits so: one
// through Slack's server reads the person's channels (decision 0059). A channel's name is the workspace's words, so it reaches
// the agent only as a run's result.
import { array, maxPreviewRows, object, optional, type PreviewTable, string } from "@oriel/core";
import type { SlackApi } from "./api.ts";
import { tsInstant } from "./source.ts";

const listing = object({
  channels: array(object({ id: string, name: string })),
  response_metadata: optional(object({ next_cursor: optional(string) })),
});
const latest = object({ messages: array(object({ ts: string })) });

// How many of the channels Slack lists first are read, one request each
// for when it was last active; the preview shows the `maxPreviewRows` most
// lately active of them.
const maxListed = 100;

export async function slackPreview(api: SlackApi): Promise<PreviewTable[]> {
  const channels: { id: string; name: string }[] = [];
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
    channels.push(...reply.value.channels);
    cursor = reply.value.response_metadata?.next_cursor ?? "";
  } while (cursor && channels.length < maxListed);
  const active = await Promise.all(
    channels.slice(0, maxListed).map(async (channel) => {
      const reply = latest(await api("conversations.history", { channel: channel.id, limit: "1" }));
      const ts = reply.ok ? reply.value.messages[0]?.ts : undefined;
      return { name: channel.name, at: ts ? tsInstant(ts) : null };
    }),
  );
  const ranked = active.toSorted(
    (a, b) => (b.at ?? "").localeCompare(a.at ?? "") || a.name.localeCompare(b.name),
  );
  return [
    {
      name: "Public channels",
      columns: ["Channel", "Last active"],
      rows: ranked
        .slice(0, maxPreviewRows)
        .map((channel) => [channel.name, channel.at?.slice(0, 10) ?? null]),
    },
  ];
}
