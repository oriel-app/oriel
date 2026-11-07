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
  ServerUnreadable,
  SourceRefused,
  type ThroughServer,
  type ToolCaller,
  type ToOpen,
} from "@oriel/core";
import { bearer, SlackError, webApi } from "./api.ts";
import { slackAttrs, slackAttrsOf } from "./attrs.ts";
import { connectSlack, slackPerson } from "./connect.ts";
import type { SlackContext } from "./namespace.ts";
import type { SlackScope } from "./references.ts";
import { slackServerReads } from "./slack-mcp.ts";
import { maxChannels, slackSource } from "./source.ts";

// What a Slack connection's writer is built from, by its line in
// packages/changeset/src/writers.ts.
export type SlackWrites = {
  // The token of the person Oriel reads Slack as, who posts; or, through a
  // source server, the server's tools: its reads and its writes (decision
  // 0059).
  credential?: Credential;
  through?: { read: ToolCaller; write: ToolCaller };
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
  if (via.server) return openThrough(connection, via, via.server);
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

// A Slack connection through the source server Slack is on through
// (decision 0059): the workspace the server reads, which must be the
// connection's if it names one, and the channels its options pick, else the
// first the person is in, as the server lists them. Every read goes through
// the server's read tools, and the writer, built only in packages/changeset,
// through its write tools, in another process.
async function openThrough(
  connection: ToOpen,
  via: OpenVia,
  server: ThroughServer,
): Promise<OpenedSlack> {
  const api = slackServerReads({ read: server.read });
  const picked = pickedOf(connection.options);
  const workspace = await connectSlack(api, picked, maxChannels);
  const named = URL.canParse(connection.identity) ? new URL(connection.identity).origin : null;
  if (named !== null && named !== new URL(workspace.url).origin)
    throw new OptionsUnfit(`${server.known.name} reads another Slack workspace than this one`);
  if (workspace.missing.length)
    throw new OptionsUnfit(
      `${server.known.name} lists no channel of yours named ${workspace.missing.map((name) => `#${name}`).join(", ")}`,
    );
  if (!workspace.channels.length)
    throw new OptionsUnfit(`${server.known.name} lists no Slack channel you're in`);
  const channels = workspace.channels.map((channel) => channel.id);
  const author = workspace.self ?? (await slackPerson(api));
  const read = slackSource({
    api,
    workspaceUrl: workspace.url,
    channels,
    log: via.log,
    whole: true,
  });
  // Each sync and read lists the channels' names again, so a renamed one
  // shows on the next.
  const source: typeof read = {
    ...read,
    sync: (cursor) => {
      api.forget();
      return read.sync(cursor);
    },
    read: (ids) => {
      api.forget();
      return read.read(ids);
    },
  };
  return {
    identity: workspace.url,
    source,
    attrs: slackAttrs,
    about: `${URL.parse(workspace.url)?.host ?? workspace.url}, through ${server.known.name}`,
    scope: { workspaceUrl: workspace.url },
    context: () => ({ channels, author }),
    writes: { channels, through: { read: server.read, write: server.write } },
    problem: (error) => serverProblem(error, server.known.name),
    names: slackNames,
  };
}

// What the person sees when Slack can't be synced through its server,
// naming it. A sync that fails this way keeps the index as it was.
export function serverProblem(error: unknown, server: string): string {
  if (error instanceof ServerUnreadable)
    return `${server} answered in a way Oriel didn't expect, so Oriel kept the window as it was.`;
  if (
    error instanceof SourceRefused ||
    (error instanceof SlackError &&
      ["not_authed", "invalid_auth", "token_revoked", "missing_token", "invalid_token"].includes(
        error.code,
      ))
  )
    return `${server} turned Oriel away, so the window may be behind Slack. Sign in to it again in your agent.`;
  return `Oriel couldn't sync Slack through ${server}, so the window may be behind it. Try again in a moment.`;
}
