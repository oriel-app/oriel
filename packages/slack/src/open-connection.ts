import {
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
import { memoryApi, readMethods, SlackError } from "./api.ts";
import { slackAttrs, slackAttrsOf } from "./attrs.ts";
import { connectSlack, slackPerson } from "./connect.ts";
import type { SlackContext } from "./namespace.ts";
import type { SlackScope } from "./references.ts";
import { searchChannel, slackServerReads } from "./slack-mcp.ts";
import { maxChannels, slackSource } from "./source.ts";

export type SlackWrites = {
  through?: { read: ToolCaller; write: ToolCaller };
  memory?: typeof fetch;
  channels: readonly string[];
};

export type OpenedSlack = Opened<SlackContext, SlackScope, SlackWrites> & {
  identity: string;
};

const pickedOf = (options: Readonly<Record<string, unknown>>): string[] =>
  Array.isArray(options.channels)
    ? options.channels.filter((name): name is string => typeof name === "string")
    : [];

export async function openSlack(connection: ToOpen, via: OpenVia): Promise<OpenedSlack> {
  if (!via.server) throw new Error("Slack opens only through its source server");
  return openThrough(connection, via, via.server);
}

export async function openMemory(
  connection: ToOpen,
  via: OpenVia,
  send: typeof fetch,
): Promise<OpenedSlack> {
  const api = memoryApi(send, readMethods, "the read side");
  const workspace = await connectSlack(api, pickedOf(connection.options));
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
    writes: { memory: send, channels },
    problem: () => "Slack didn't answer, so Oriel couldn't look for new messages.",
    names: slackNames,
  };
}

function* slackNames(records: readonly IndexRecord[]): Iterable<readonly [string, string]> {
  for (const record of records) {
    const attrs = slackAttrsOf(record);
    if (!attrs) continue;
    yield [attrs.channel.id, attrs.channel.name];
    if (attrs.author.id !== null) yield [attrs.author.id, attrs.author.name];
  }
}

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
  // The server doesn't list a picked channel the person isn't in: find it by name through its
  // search, or by ID through its history.
  const missing: string[] = [];
  for (const want of workspace.missing) {
    if (/^[CG][A-Z0-9]{2,20}$/.test(want)) {
      const found = await api("conversations.info", { channel: want }).catch(() => null);
      const channel = found as { channel?: { id: string; name: string } } | null;
      if (channel?.channel) workspace.channels.push(channel.channel);
      else missing.push(want);
      continue;
    }
    const found = (await searchChannel(server.read, want)).filter(
      (each) => each.workspace === workspace.url,
    );
    if (found.length === 1 && found[0]) workspace.channels.push(found[0]);
    else missing.push(want);
  }
  if (missing.length)
    throw new OptionsUnfit(
      `${server.known.name} finds no public channel named ${missing.map((name) => `#${name}`).join(", ")}`,
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
