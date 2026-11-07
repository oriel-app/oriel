// A stand-in's MCP server, on no SDK: a JSON-RPC message in, its answer out,
// over stdio, one message a line. It offers tools only, and speaks the two
// revisions `packages/sheets-mcp` does: 2025-06-18, which opens with
// `initialize`, and 2026-07-28, where a client may ask `server/discover`
// instead and each request may carry its revision in `_meta`.
// https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle
import { createInterface } from "node:readline";
import type { StandInTool } from "@oriel/core";

export const modern = "2026-07-28";
export const handshake = "2025-06-18";
const revisions = [modern, handshake];

export type Id = string | number;
export type Answer = { jsonrpc: "2.0"; id: Id | null } & (
  | { result: Record<string, unknown> }
  | { error: { code: number; message: string } }
);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const codes = {
  parse: -32700,
  invalidRequest: -32600,
  notFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const;

export function standInServer(info: { name: string; version: string }, tools: StandInTool[]) {
  const capabilities = { tools: { listChanged: false } };
  let agreed: string | null = null;
  const listed = tools.map(({ name, description, inputSchema, annotations }) => ({
    name,
    description,
    inputSchema,
    annotations,
  }));

  return {
    // The answer to one message, or null for a notification or an answer.
    async handle(message: unknown): Promise<Answer | null> {
      const id: Id | null =
        isObject(message) && (typeof message.id === "string" || typeof message.id === "number")
          ? message.id
          : null;
      const fail = (code: number, text: string): Answer => ({
        jsonrpc: "2.0",
        id,
        error: { code, message: text },
      });
      if (!isObject(message) || message.jsonrpc !== "2.0")
        return fail(codes.invalidRequest, "Not a JSON-RPC 2.0 message");
      if (typeof message.method !== "string" || !("id" in message)) return null;
      const params = isObject(message.params) ? message.params : {};
      const meta = isObject(params._meta) ? params._meta : {};
      const said = meta["io.modelcontextprotocol/protocolVersion"];
      const version = typeof said === "string" ? said : agreed;
      const answer = (result: Record<string, unknown>): Answer => ({
        jsonrpc: "2.0",
        id,
        result: version === modern ? { resultType: "complete", ...result } : result,
      });
      switch (message.method) {
        case "initialize": {
          const asked = params.protocolVersion;
          agreed = typeof asked === "string" && revisions.includes(asked) ? asked : handshake;
          return {
            jsonrpc: "2.0",
            id,
            result: { protocolVersion: agreed, capabilities, serverInfo: info },
          };
        }
        case "server/discover":
          return answer({
            supportedVersions: revisions,
            capabilities,
            _meta: { "io.modelcontextprotocol/serverInfo": info },
          });
        case "ping":
          return answer({});
        case "tools/list":
          return answer({ tools: listed });
        case "tools/call": {
          const tool = tools.find((each) => each.name === params.name);
          if (!tool) return fail(codes.invalidParams, `Unknown tool: ${String(params.name)}`);
          const args = params.arguments ?? {};
          if (!isObject(args)) return fail(codes.invalidParams, "Arguments are an object");
          return answer(await tool.call(args));
        }
        default:
          return fail(codes.notFound, `Method not found: ${message.method}`);
      }
    },
  };
}

export type StandInServer = ReturnType<typeof standInServer>;

// Serves `server` on `input` and `output` until the input ends: nothing but
// answers on `output`, one a line.
export async function serveLines(
  server: StandInServer,
  input: NodeJS.ReadableStream,
  output: { write(text: string): unknown },
): Promise<void> {
  const pending = new Set<Promise<unknown>>();
  const send = (message: unknown) => output.write(`${JSON.stringify(message)}\n`);
  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    if (line.trim() === "") continue;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: codes.parse, message: "Parse error" } });
      continue;
    }
    const done = server.handle(message).then(
      (answer) => answer && send(answer),
      () => send({ jsonrpc: "2.0", id: null, error: { code: codes.internal, message: "Failed" } }),
    );
    pending.add(done);
    void done.finally(() => pending.delete(done));
  }
  await Promise.all(pending);
}
