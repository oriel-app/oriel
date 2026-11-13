import {
  type ItemId,
  itemId,
  type LoadedFixture,
  listed,
  parseItemId,
  type SourceFixture,
} from "@oriel/core";
import { memoryApi, readMethods } from "./api.ts";
import { fixtureApi, loadSlackFixture, type SlackFixture } from "./fixture.ts";
import type { SlackContext } from "./namespace.ts";
import { openMemory, type SlackWrites } from "./open-connection.ts";
import { slackPreview } from "./preview.ts";
import type { SlackScope } from "./references.ts";
import { slackSource } from "./source.ts";

export const slackDeclaredFixture: SourceFixture<SlackContext, SlackScope, SlackWrites> = {
  load: () => loaded(loadSlackFixture()),
  windowCase: true,
  connection: () => {
    const fixture = loadSlackFixture();
    return { identity: fixture.team.url, options: { channels: fixture.picked } };
  },
  open: (connection, via) =>
    openMemory(
      connection,
      via,
      via.fetch ?? fixtureApi(loadSlackFixture(), { now: via.now }).fetch,
    ),
  memory: (connection, via) => openMemory(connection, via, via.fetch),
  preview: (_connection, via) =>
    slackPreview(
      memoryApi(
        via.fetch ?? fixtureApi(loadSlackFixture(), { now: via.now }).fetch,
        readMethods,
        "the read side",
      ),
    ),
};

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
    item: (key) =>
      posted.has(key)
        ? { id: itemId("slack", key) }
        : { problem: "not a message in the Slack fixture's picked channel" },
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
      const { records, texts } = await listed(source.sync(null));
      const author = fixture.users[0]?.id;
      if (!author) throw new Error("the Slack fixture has no people");
      return {
        records,
        texts,
        read: (ids) => source.read(ids as ItemId<"slack">[]),
        context: { channels: fixture.picked, author },
        changes: () => [],
        close: () => {},
      };
    },
  };
}
