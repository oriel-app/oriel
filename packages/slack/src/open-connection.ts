// A Slack connection, opened (decision 0049): its options name the public
// channels it reads, by name or ID, and its secret is the token of the
// person Oriel reads Slack as, who posts. What identifies it is the
// workspace that token is for, which opening finds. A channel it can't find
// stops it opening.
import {
  type Credential,
  type IndexRecord,
  type Opened,
  type OpenVia,
  OptionsUnfit,
  type ToOpen,
} from "@oriel/core";
import { bearer, webApi } from "./api.ts";
import { slackAttrs, slackAttrsOf } from "./attrs.ts";
import { connectSlack, slackPerson } from "./connect.ts";
import type { SlackContext } from "./namespace.ts";
import type { SlackScope } from "./references.ts";
import { slackSource } from "./source.ts";

// What a Slack connection's writer is built from, by its line in
// packages/changeset/src/writers.ts.
export type SlackWrites = {
  // The token of the person Oriel reads Slack as, who posts.
  credential: Credential;
  // The channels the connection reads, by ID: the only ones written to.
  channels: readonly string[];
  // How requests reach Slack's Web API: the global fetch unless given, as
  // the synthetic workspace gives one that answers from memory.
  fetch?: typeof fetch;
};

export type OpenedSlack = Opened<SlackContext, SlackScope, SlackWrites> & {
  // The workspace's address, which identifies the connection.
  identity: string;
};

// The channels a connection's options pick.
const pickedOf = (options: Readonly<Record<string, unknown>>): string[] =>
  Array.isArray(options.channels)
    ? options.channels.filter((name): name is string => typeof name === "string")
    : [];

export async function openSlack(connection: ToOpen, via: OpenVia): Promise<OpenedSlack> {
  const credential = bearer(connection.secret ?? "");
  const send = via.fetch ? { fetch: via.fetch } : {};
  const api = webApi({ credential, ...send });
  const workspace = await connectSlack(api, pickedOf(connection.options));
  // Channels it no longer finds don't fit its options: it waits for new
  // ones (decision 0051).
  if (workspace.missing.length)
    throw new OptionsUnfit(
      `Slack has no public channel Oriel can see named ${workspace.missing.map((name) => `#${name}`).join(", ")}`,
    );
  if (!workspace.channels.length) throw new OptionsUnfit("Pick at least one Slack channel to read");
  const channels = workspace.channels.map((channel) => channel.id);
  const author = await slackPerson(api);
  return {
    identity: workspace.url,
    source: slackSource({ api, workspaceUrl: workspace.url, channels, log: via.log }),
    attrs: slackAttrs,
    about: URL.parse(workspace.url)?.host ?? workspace.url,
    scope: { workspaceUrl: workspace.url },
    context: () => ({ channels, author }),
    writes: { credential, channels, ...send },
    problem: () => "Slack didn't answer, so Oriel couldn't look for new messages.",
    names: slackNames,
  };
}

// The channels and authors of the messages indexed, by ID.
function* slackNames(records: readonly IndexRecord[]): Iterable<readonly [string, string]> {
  for (const record of records) {
    const attrs = slackAttrsOf(record);
    if (!attrs) continue;
    yield [attrs.channel.id, attrs.channel.name];
    if (attrs.author.id !== null) yield [attrs.author.id, attrs.author.name];
  }
}
