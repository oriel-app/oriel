// Source servers (decision 0059): the MCP servers in the person's own agent
// that Oriel reads a source through. A connector declares the ones it knows;
// the agent reports the ones the person has; telling which kind a server
// serves is a lookup between the two, with no model call, so nothing a
// server says of itself, such as its description, can steer it.

// A source server a connector knows, as its declaration gives it: what a
// person calls it, how it's recognised (the name it reports, its address or
// command where that's fixed, and the tools it must offer), and where its
// vendor says how to add it to an agent, which Oriel never does itself.
export type SourceServer = {
  // Such as "Atlassian's Jira server".
  name: string;
  // The name it reports in its MCP handshake.
  reports: string;
  // Where it is, where that's fixed: its URL, or the command line that
  // starts it, as the person's agent runs it.
  at?: { url: string } | { command: string };
  // The tools sync reads with, every one of which it must offer to count,
  // and those a change set's replay writes with.
  reads: readonly string[];
  writes: readonly string[];
  // Its vendor's own instructions for adding it to an agent.
  instructions: string;
};

// What the person's agent said of one of its MCP servers: its name in the
// agent's configuration, whether it's connected, the name it reports, its
// URL or command line, and its tools' names. Nothing of it is trusted but
// as a key to look up.
export type FoundServer = {
  name: string;
  status: "connected" | "needs-auth" | "failed" | "pending" | "disabled";
  reports: string | null;
  url: string | null;
  command: string | null;
  tools: readonly string[];
  // How a remote one is reached, where the agent says: what a process that
  // loads it alone names it with, with its URL.
  transport?: "http" | "sse";
};

// A found server Oriel knows, with the kind it serves and the entry it
// matched.
export type Recognized = { kind: string; known: SourceServer; found: FoundServer };

// A URL as two spellings of it compare: its origin and path, with no
// trailing slash, query or fragment.
const urlKey = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
};

// Whether a found server is the known one, and offers every read tool. One
// whose entry gives its address is it only at that address, whatever it
// reports: a server anywhere else could report the same name, and would
// then feed the kind. One whose entry gives no address is known by the name
// it reports. One whose tools the agent couldn't list, as one that needs
// signing in, isn't.
export function serves(known: SourceServer, found: FoundServer): boolean {
  const at = known.at;
  const placed =
    at === undefined
      ? found.reports !== null && found.reports === known.reports
      : "url" in at
        ? found.url !== null && urlKey(found.url) !== null && urlKey(found.url) === urlKey(at.url)
        : found.command !== null && found.command === at.command;
  return placed && known.reads.every((tool) => found.tools.includes(tool));
}

// Each found server Oriel knows, with its kind, in the order the agent
// listed them; one that matches two kinds' entries serves the first
// declared. A server Oriel doesn't know isn't in it, so it's never offered.
export function recognize(
  found: readonly FoundServer[],
  known: readonly { kind: string; server: SourceServer }[],
): Recognized[] {
  return found.flatMap((each) => {
    const match = known.find(({ server }) => serves(server, each));
    return match ? [{ kind: match.kind, known: match.server, found: each }] : [];
  });
}

// One call of a source server's tool, by its name on the server, and its
// arguments.
export type ToolCall = { tool: string; args: Readonly<Record<string, unknown>> };

// A tool's answer, as MCP gives it: its content blocks, its structured
// content where it has some, and whether the tool failed. Source content,
// which only its connector's parser reads.
export type ToolAnswer = {
  content: readonly unknown[];
  structuredContent?: unknown;
  isError?: boolean;
};

// Calls a source server's tools from one process the person's agent runs.
export type ToolCaller = (call: ToolCall) => Promise<ToolAnswer>;

// How a connection reaches the source server its kind is on through
// (decision 0059): the server, as the person's agent lists it and as the
// entry it matched names it; its reads, from a process with only its read
// tools; and its writes, a change set's replay, from another with only its
// write tools. Sync and replay never share a process.
export type ThroughServer = {
  known: SourceServer;
  found: FoundServer;
  read: ToolCaller;
  write: ToolCaller;
};

// A source server's answer Oriel can't read (decision 0059): the sync
// stops, and the index stays as it was. Its message names the tool and what
// was wrong, never the answer.
export class ServerUnreadable extends Error {
  override name = "ServerUnreadable";
}

// The words of an answer's text blocks, as one.
export const answerText = (answer: ToolAnswer): string =>
  answer.content
    .flatMap((block) =>
      typeof block === "object" && block !== null && "type" in block && block.type === "text"
        ? [String((block as { text?: unknown }).text)]
        : [],
    )
    .join("");

// A tool's answer as JSON: its structured content, or its text parsed. Text
// that isn't JSON can't be read.
export function answerJson(tool: string, answer: ToolAnswer): unknown {
  if (typeof answer !== "object" || answer === null || !Array.isArray(answer.content))
    throw new ServerUnreadable(`${tool} answered with no content`);
  if (answer.structuredContent !== undefined && answer.structuredContent !== null)
    return answer.structuredContent;
  try {
    return JSON.parse(answerText(answer)) as unknown;
  } catch {
    throw new ServerUnreadable(`${tool} answered with text that isn't JSON`);
  }
}

// A sync through a source server reads every page before it gives one, so
// a page it can't read stops it before anything lands: the index stays as
// it was.
export async function* readWhole<T>(pages: AsyncIterable<T>): AsyncGenerator<T> {
  const read: T[] = [];
  for await (const page of pages) read.push(page);
  yield* read;
}

// A tool as a stand-in of a source server serves it (packages/standin-mcp):
// as `tools/list` shows it, and its answer to a call, failed or not.
export type StandInTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; destructiveHint?: boolean };
  call(args: Record<string, unknown>): Promise<StandInAnswer>;
};

export type StandInAnswer = { content: { type: "text"; text: string }[]; isError?: true };

// A stand-in's tools as a caller in this process: what the person's agent
// would answer through it, for tests.
export const standInCalls =
  (tools: readonly StandInTool[]): ToolCaller =>
  async (call) => {
    const tool = tools.find((each) => each.name === call.tool);
    if (!tool) throw new Error(`the stand-in has no tool ${call.tool}`);
    return tool.call({ ...call.args });
  };
