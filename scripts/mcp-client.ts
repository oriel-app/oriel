// A small MCP client for Oriel's door (decision 0024, OA-75): the 2026-07-28
// revision over Streamable HTTP, with no SDK, as scripts/hub.ts drives
// Oriel with. A call is one POST, its headers saying what its body does; a
// subscription is one POST whose answer is an event stream that stays open.
// What it reads comes back marked as data, which `read` takes off: the
// caller still treats it as data, never as instructions.

const version = "2026-07-28";

export type Door = { url: string; token: string };

// A refusal the door gave: a JSON-RPC error, or a tool's error.
export class Refused extends Error {}
// A resource the door has no such thing for, as a thread that's gone.
export class NotFound extends Refused {}

let id = 0;
const headers = (door: Door, method: string, name?: string): Record<string, string> => ({
  authorization: `Bearer ${door.token}`,
  accept: "application/json, text/event-stream",
  "content-type": "application/json",
  "mcp-protocol-version": version,
  "mcp-method": method,
  ...(name === undefined ? {} : { "mcp-name": name }),
});
const body = (method: string, params: Record<string, unknown>, at = ++id) =>
  JSON.stringify({
    jsonrpc: "2.0",
    id: at,
    method,
    params: {
      ...params,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": version,
        "io.modelcontextprotocol/clientInfo": { name: "oriel-hub", version: "0" },
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    },
  });

export async function request(
  door: Door,
  method: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const named = params["name"] ?? params["uri"];
  const reply = await fetch(door.url, {
    method: "POST",
    headers: headers(door, method, typeof named === "string" ? named : undefined),
    body: body(method, params),
  });
  if (reply.status === 401) throw new Refused("The door refused this tool's token.");
  const answer = (await reply.json()) as {
    result?: Record<string, unknown>;
    error?: { message: string };
  };
  if (answer.error)
    throw answer.error.message === "Resource not found"
      ? new NotFound(answer.error.message)
      : new Refused(answer.error.message);
  return answer.result ?? {};
}

const dataLine = /^Data from Oriel: [^\n]*\n/;

// A resource's JSON, as the window reads it.
export async function read<T>(door: Door, uri: string): Promise<T> {
  const result = await request(door, "resources/read", { uri });
  const [content] = result["contents"] as { text: string }[];
  return JSON.parse((content?.text ?? "").replace(dataLine, "")) as T;
}

// A tool's structured result; its words when it refused.
export async function call<T>(door: Door, name: string, args: Record<string, unknown>): Promise<T> {
  const result = await request(door, "tools/call", { name, arguments: args });
  const text = (result["content"] as { text: string }[] | undefined)?.[0]?.text ?? "";
  if (result["isError"]) throw new Refused(text);
  const structured = result["structuredContent"] as { data?: unknown } | undefined;
  return (structured && "data" in structured ? structured.data : structured) as T;
}

// Each resource the door says changed, by URI, until `signal` stops it;
// first "", once the door acknowledged the subscription, so what's read
// after it can't miss a change.
export async function* updates(
  door: Door,
  uris: readonly string[],
  signal: AbortSignal,
): AsyncGenerator<string> {
  const reply = await fetch(door.url, {
    method: "POST",
    headers: headers(door, "subscriptions/listen"),
    body: body("subscriptions/listen", { notifications: { resourceSubscriptions: uris } }),
    signal,
  });
  if (!reply.ok || !reply.body) throw new Refused(`subscriptions/listen: ${reply.status}`);
  const decoder = new TextDecoder();
  let buffered = "";
  for await (const chunk of reply.body) {
    buffered += decoder.decode(chunk, { stream: true });
    const events = buffered.split("\n\n");
    buffered = events.pop() ?? "";
    for (const event of events)
      for (const line of event.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const message = JSON.parse(line.slice(6)) as { method: string; params: { uri?: string } };
        if (message.method === "notifications/subscriptions/acknowledged") yield "";
        if (message.method === "notifications/resources/updated" && message.params.uri)
          yield message.params.uri;
      }
  }
}
