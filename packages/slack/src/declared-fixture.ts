// The Ferrowick workspace as Slack's declared fixture (decision 0049):
// `fixtures/slack/`, read by the real Slack source through the fixture's Web
// API, in the channel the user picked there.
import {
  type ItemId,
  itemId,
  type LoadedFixture,
  parseItemId,
  type SourceFixture,
} from "@oriel/core";
import type { SlackRecord } from "./attrs.ts";
import { fixtureApi, loadSlackFixture, type SlackFixture } from "./fixture.ts";
import type { SlackContext } from "./namespace.ts";
import { slackSource } from "./source.ts";

export const slackDeclaredFixture: SourceFixture<SlackContext> = {
  load: () => loaded(loadSlackFixture()),
};

// What people posted in the fixture's picked channels: not replies, joins or
// the placeholder a deleted message leaves.
const posts = new Set([undefined, "bot_message", "file_share", "me_message"]);

function loaded(fixture: SlackFixture): LoadedFixture<SlackContext> {
  const posted = new Set(
    fixture.channels
      .filter((channel) => fixture.picked.includes(channel.id))
      .flatMap((channel) =>
        channel.messages.filter((m) => posts.has(m.subtype)).map((m) => `${channel.id}-${m.ts}`),
      ),
  );
  const messageOf = (id: ItemId) => {
    const parsed = parseItemId(id);
    if (parsed?.kind !== "slack") return undefined;
    const [channel, ts] = parsed.key.split("-");
    return fixture.channels.find((c) => c.id === channel)?.messages.find((m) => m.ts === ts);
  };
  return {
    edits: 0,
    firstEdit: null,
    regions: [],
    // A message by its key, its channel and its `ts`.
    item: (key) =>
      posted.has(key)
        ? { id: itemId("slack", key) }
        : { problem: "not a message in the Slack fixture's picked channel" },
    // By its author, a person or the app that posted as itself.
    called: (id) => {
      const message = messageOf(id);
      const person = fixture.users.find((user) => user.id === message?.user);
      return person?.real_name ?? message?.username ?? null;
    },
    chips: () =>
      fixture.channels.flatMap((channel) =>
        channel.messages.map((message) => {
          const person = fixture.users.find((user) => user.id === message.user);
          const who = person?.real_name ?? message.username ?? "someone";
          return [itemId("slack", `${channel.id}-${message.ts}`), `${who}'s message`] as const;
        }),
      ),
    connect: async () => {
      const source = slackSource({
        api: fixtureApi(fixture).api,
        workspaceUrl: fixture.team.url,
        channels: fixture.picked,
        log: () => {},
      });
      const records: SlackRecord[] = [];
      for await (const page of source.sync(null)) records.push(...page.records);
      // It posts as the fixture's first person, in its picked channels.
      const author = fixture.users[0]?.id;
      if (!author) throw new Error("the Slack fixture has no people");
      return {
        records,
        read: (ids) => source.read(ids as ItemId<"slack">[]),
        context: { channels: fixture.picked, author },
        changes: () => [],
        close: () => {},
      };
    },
  };
}
