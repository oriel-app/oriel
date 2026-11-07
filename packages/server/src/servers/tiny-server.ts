// A tiny stdio MCP server, in tests and shots only (OA-275): a tracker's
// source server as a person's agent would list it, with no SDK and nothing
// behind its tools. Not a package, and never shipped. It answers
// `server/discover` (2026-07-28), which Claude Code opens with, as well as
// `initialize` (2025-06-18), as every stdio server Oriel writes must.
//
// Run as `node tiny-server.ts [name]`: `name` is what it reports, by
// default the name the test entry in testing.ts knows, and
// `--no-get` leaves out a read tool, for a server that isn't recognised.
import { createInterface } from "node:readline";

const modern = "2026-07-28";
const handshake = "2025-06-18";

const args = process.argv.slice(2);
const serverInfo = {
  name: args.find((arg) => !arg.startsWith("--")) ?? "oriel-test-tracker",
  version: "0.0.1",
};
const tools = ["search_issues", "get_issue", "create_issue"]
  .filter((name) => !(name === "get_issue" && args.includes("--no-get")))
  .map((name) => ({ name, inputSchema: { type: "object", properties: {} } }));
const capabilities = { tools: { listChanged: false } };

type Message = Record<string, unknown>;
const isObject = (value: unknown): value is Message =>
  typeof value === "object" && value !== null && !Array.isArray(value);

let agreed = handshake;
const answer = (message: Message): Message | null => {
  if (!("id" in message) || typeof message.method !== "string") return null;
  const { id } = message;
  const params = isObject(message.params) ? message.params : {};
  const ok = (result: Message) => ({
    jsonrpc: "2.0",
    id,
    result: agreed === modern ? { resultType: "complete", ...result } : result,
  });
  switch (message.method) {
    case "initialize":
      agreed = params.protocolVersion === modern ? modern : handshake;
      return { jsonrpc: "2.0", id, result: { protocolVersion: agreed, capabilities, serverInfo } };
    case "server/discover":
      agreed = modern;
      return ok({
        supportedVersions: [modern, handshake],
        capabilities,
        _meta: { "io.modelcontextprotocol/serverInfo": serverInfo },
      });
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools });
    case "tools/call":
      return ok({ content: [{ type: "text", text: "[]" }] });
    default:
      return { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } };
  }
};

createInterface({ input: process.stdin }).on("line", (line) => {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const reply = isObject(message) ? answer(message) : null;
  if (reply) process.stdout.write(`${JSON.stringify(reply)}\n`);
});
