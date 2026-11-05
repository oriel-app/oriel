// The MCP door's transport (decision 0024): Streamable HTTP, on loopback, on a
// listener of its own, so the window's rule, that only its own page reaches
// it, stays whole, and no cookie of the window's opens this door, nor any
// token of a tool's the window. Every request:
// - names this listener in Host, so a site that rebinds its domain to
//   127.0.0.1 is refused (DNS rebinding);
// - carries no Origin: an MCP client is a program, never a page, so any
//   page's request is refused, whatever its origin;
// - carries a connected tool's token as a bearer token: one revoked, or
//   none, is refused;
// - in the 2026-07-28 revision, says its version, method and name in headers
//   that match its body.
// Each request is a POST, answered with JSON, but for `subscriptions/listen`,
// whose answer is an event stream that stays open.
import { createServer } from "node:http";
import { ownHosts } from "../guard.ts";
import { bodyReader, listen, send } from "../serve.ts";
import type { Reply } from "../site.ts";
import { channel } from "../stream.ts";
import { codes, type McpServer, type Message, modern, versionOf } from "./protocol.ts";
import type { OAuth } from "./oauth.ts";
import type { ConnectedTool, OutsideTools } from "./tokens.ts";

export type McpRequest = {
  method: string;
  url: string;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  body: (limit: number) => Promise<string | null>;
};

const maxBody = 1_000_000;

const header = (request: McpRequest, name: string): string | undefined => {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

// A header value as its client encoded it: plain, or Base64 between the
// sentinels.
const decoded = (value: string | undefined): string | undefined => {
  const base64 = value && /^=\?base64\?(.*)\?=$/.exec(value);
  return base64 ? Buffer.from(base64[1] ?? "", "base64").toString("utf8") : value;
};

const json = (status: number, value: unknown, headers: Record<string, string> = {}): Reply => ({
  status,
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(value),
});
const refused = (status: number, code: number, message: string, headers = {}): Reply =>
  json(status, { jsonrpc: "2.0", id: null, error: { code, message } }, headers);

// Whether the request reaches the door at all: it names this listener, and
// no page sent it.
function admitted(request: McpRequest, port: number): Reply | null {
  const host = header(request, "host")?.toLowerCase();
  if (host === undefined || !ownHosts(port).includes(host))
    return refused(403, codes.invalidRequest, "Host is not this server");
  if (header(request, "origin") !== undefined)
    return refused(403, codes.invalidRequest, "A web page may not reach Oriel's MCP door");
  return null;
}

// Why the request is refused before its body is read, or the tool it is.
// `signIn`: where a 401 points a client that signs in with OAuth.
export function door(
  request: McpRequest,
  port: number,
  tools: Pick<OutsideTools, "who">,
  signIn?: string,
): Reply | ConnectedTool {
  const refusal = admitted(request, port);
  if (refusal) return refusal;
  if (new URL(request.url, "http://door").pathname !== "/mcp")
    return refused(404, codes.notFound, "Oriel's MCP endpoint is /mcp");
  if (request.method !== "POST") return { status: 405, headers: { allow: "POST" }, body: "" };
  const bearer = /^Bearer (\S+)$/.exec(header(request, "authorization") ?? "")?.[1];
  const tool = bearer === undefined ? null : tools.who(bearer);
  if (!tool)
    return refused(401, codes.invalidRequest, "Connect this tool in Oriel's Settings first", {
      "www-authenticate": signIn
        ? `Bearer realm="oriel", resource_metadata="${signIn}", scope="oriel"`
        : 'Bearer realm="oriel"',
    });
  return tool;
}

// Whether a 2026-07-28 request's headers say what its body says.
function mismatch(request: McpRequest, message: Message): string | null {
  if (header(request, "mcp-protocol-version") !== modern) return "MCP-Protocol-Version";
  if (header(request, "mcp-method") !== message.method) return "Mcp-Method";
  const named = message.params?.["name"] ?? message.params?.["uri"];
  const needsName = ["tools/call", "resources/read", "prompts/get"].includes(message.method);
  if (needsName && decoded(header(request, "mcp-name")) !== named) return "Mcp-Name";
  return null;
}

const isMessage = (value: unknown): value is Message =>
  typeof value === "object" &&
  value !== null &&
  (value as Message).jsonrpc === "2.0" &&
  typeof (value as Message).method === "string";

export function mcpHandler(deps: {
  server: McpServer;
  tools: Pick<OutsideTools, "who" | "onRevoke">;
  port: number;
  // Signing in with OAuth, with the consent in the window; absent, a tool
  // signs in only with a pasted token.
  oauth?: Pick<OAuth, "handle" | "resourceMetadata">;
  // Writes the stream's keep-alive, every so often, until it is stopped.
  keepAlive?: (beat: () => void) => () => void;
}) {
  // Each tool's open streams, which end as it is revoked.
  const streams = new Map<string, Set<() => void>>();
  deps.tools.onRevoke((id) => {
    for (const end of streams.get(id) ?? []) end();
    streams.delete(id);
  });
  return async (request: McpRequest): Promise<Reply> => {
    if (deps.oauth) {
      const refusal = admitted(request, deps.port);
      if (refusal) return refusal;
      const signing = await deps.oauth.handle(
        request.method,
        new URL(request.url, "http://door"),
        () => request.body(64_000),
        header(request, "sec-fetch-site"),
      );
      if (signing) return signing;
    }
    const tool = door(request, deps.port, deps.tools, deps.oauth?.resourceMetadata);
    if ("status" in tool) return tool;
    const text = await request.body(maxBody);
    if (text === null) return refused(413, codes.invalidRequest, "Too large");
    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      return refused(400, -32700, "Parse error");
    }
    if (!isMessage(message)) return refused(400, codes.invalidRequest, "Invalid request");
    const said = header(request, "mcp-protocol-version") ?? null;
    if (versionOf(message, null) === modern) {
      const wrong = mismatch(request, message);
      if (wrong)
        return json(400, {
          jsonrpc: "2.0",
          id: message.id ?? null,
          error: { code: codes.headerMismatch, message: `Header mismatch: ${wrong}` },
        });
    }
    if (message.method === "subscriptions/listen") {
      const open = streams.get(tool.id) ?? new Set<() => void>();
      streams.set(tool.id, open);
      const events = channel<string>(() => {
        open.delete(events.end);
        stop();
      });
      open.add(events.end);
      const sent = (value: unknown) => events.push(`data: ${JSON.stringify(value)}\n\n`);
      const listening = deps.server.listen(message, sent);
      if (typeof listening !== "function") return json(400, listening);
      const quiet = deps.keepAlive?.(() => events.push(":\n\n")) ?? (() => {});
      const stop = () => {
        listening();
        quiet();
      };
      return {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-store",
          "x-accel-buffering": "no",
        },
        body: "",
        stream: events.iterator,
      };
    }
    const response = await deps.server.handle(message, tool, said);
    if (response === null) return { status: 202, headers: {}, body: "" };
    if ("error" in response) {
      const status =
        response.error.code === codes.unsupportedVersion
          ? 400
          : response.error.code === codes.notFound && said === modern
            ? 404
            : 200;
      return json(status, response);
    }
    return json(200, response);
  };
}

// The door on loopback, on the first of `ports` that's free.
export async function serveMcp(
  ports: readonly number[],
  make: (port: number) => (request: McpRequest) => Promise<Reply>,
): Promise<{ url: string; port: number; close(): Promise<void> }> {
  const server = createServer();
  const { port } = await listen(server, ports);
  const handle = make(port);
  server.on("request", (req, res) => {
    const method = req.method ?? "GET";
    handle({ method, url: req.url ?? "/", headers: req.headers, body: bodyReader(req) })
      .then((reply) => send(res, method, reply))
      .catch((error: unknown) => {
        console.error(error);
        if (res.headersSent) return void res.destroy();
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        res.end("internal error\n");
      });
  });
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
