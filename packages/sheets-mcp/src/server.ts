// Nothing it answers holds a token, a code, or the client's ID or secret: every answer
// passes through `redact` on its way out.
import type { AccessSource } from "./access.ts";
import { type Google, Refusal } from "./google.ts";
import type { Fetch } from "./oauth.ts";
import { type Tool, tools } from "./tools.ts";

export const modern = "2026-07-28";
export const handshake = "2025-06-18";
export const revisions = [modern, handshake] as const;

export type Id = string | number;
export type Answer = { jsonrpc: "2.0"; id: Id | null } & (
  | { result: Record<string, unknown> }
  | { error: { code: number; message: string; data?: unknown } }
);

export const codes = {
  parse: -32700,
  invalidRequest: -32600,
  notFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const;

export const serverInfo = { name: "sheets-mcp", title: "Google Sheets", version: "0.1.0" };
const capabilities = { tools: { listChanged: false } };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function redact<T>(value: T, secrets: readonly string[]): T {
  const known = secrets.filter((secret) => secret.length >= 6);
  if (!known.length) return value;
  const scrub = (text: string) =>
    known.reduce((done, secret) => done.replaceAll(secret, "[redacted]"), text);
  const walk = (each: unknown): unknown =>
    typeof each === "string"
      ? scrub(each)
      : Array.isArray(each)
        ? each.map(walk)
        : isObject(each)
          ? Object.fromEntries(Object.entries(each).map(([k, v]) => [scrub(k), walk(v)]))
          : each;
  return walk(value) as T;
}

export type ServerDeps = {
  fetch: Fetch;
  source: AccessSource;
  // Gets the error's name only: its message could hold a secret.
  log?: (line: string) => void;
};

export function mcpServer(deps: ServerDeps) {
  const google: Google = { fetch: deps.fetch, source: deps.source };
  let agreed: string | null = null;
  const listed = tools.map(
    ({ name, title, description, inputSchema, outputSchema, annotations }) => ({
      name,
      title,
      description,
      inputSchema,
      outputSchema,
      annotations,
    }),
  );

  async function call(tool: Tool, args: Record<string, unknown>) {
    try {
      const result = await tool.call(args, google);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      };
    } catch (error) {
      const told =
        error instanceof Refusal
          ? error.message
          : "The tool failed in a way it didn't expect. Try again.";
      if (!(error instanceof Refusal))
        deps.log?.(
          `sheets-mcp: ${tool.name} failed (${error instanceof Error ? error.name : "?"})`,
        );
      return { content: [{ type: "text", text: told }], isError: true };
    }
  }

  async function answer(message: unknown): Promise<Answer | null> {
    const id: Id | null =
      isObject(message) && (typeof message.id === "string" || typeof message.id === "number")
        ? message.id
        : null;
    const fail = (code: number, text: string, data?: unknown): Answer => ({
      jsonrpc: "2.0",
      id,
      error: { code, message: text, ...(data === undefined ? {} : { data }) },
    });
    if (!isObject(message) || message.jsonrpc !== "2.0")
      return fail(codes.invalidRequest, "Not a JSON-RPC 2.0 message");
    if (typeof message.method !== "string") {
      if ("result" in message || "error" in message) return null;
      return fail(codes.invalidRequest, "No method");
    }
    if (!("id" in message)) return null;
    if (id === null) return fail(codes.invalidRequest, "An ID is a string or a number");
    if (message.params !== undefined && !isObject(message.params))
      return fail(codes.invalidParams, "Params are an object");
    const params = message.params ?? {};
    const meta = isObject(params._meta) ? params._meta : {};
    const said = meta["io.modelcontextprotocol/protocolVersion"];
    const version = typeof said === "string" ? said : agreed;
    const ok = (result: Record<string, unknown>): Answer => ({
      jsonrpc: "2.0",
      id,
      result: version === modern ? { resultType: "complete", ...result } : result,
    });

    switch (message.method) {
      case "initialize": {
        const asked = params.protocolVersion;
        agreed = (revisions as readonly unknown[]).includes(asked) ? (asked as string) : handshake;
        return {
          jsonrpc: "2.0",
          id,
          result: { protocolVersion: agreed, capabilities, serverInfo },
        };
      }
      case "server/discover":
        return ok({
          supportedVersions: revisions,
          capabilities,
          _meta: { "io.modelcontextprotocol/serverInfo": serverInfo },
        });
      case "ping":
        return ok({});
      case "tools/list":
        return ok({ tools: listed });
      case "tools/call": {
        const tool = tools.find((each) => each.name === params.name);
        if (!tool) return fail(codes.invalidParams, `Unknown tool: ${String(params.name)}`);
        const args = params.arguments ?? {};
        if (!isObject(args)) return fail(codes.invalidParams, "Arguments are an object");
        return ok(await call(tool, args));
      }
      default:
        return fail(codes.notFound, `Method not found: ${message.method}`);
    }
  }

  return {
    async handle(message: unknown): Promise<Answer | null> {
      const reply = await answer(message);
      return reply && redact(reply, deps.source.secrets());
    },
  };
}

export type McpServer = ReturnType<typeof mcpServer>;
