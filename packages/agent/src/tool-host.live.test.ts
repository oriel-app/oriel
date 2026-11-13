// Skipped unless ORIEL_LIVE_CLAUDE_CODE=1. No model runs, and the CLI keeps its state in a folder
// of the test's own, never the person's `~/.claude`.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { harnessEnv, locateClaudeCode } from "./claude-code.ts";
import { openToolHost, toolHostArgs } from "./tool-host.ts";

const live = process.env.ORIEL_LIVE_CLAUDE_CODE === "1";
const skip = live ? false : "set ORIEL_LIVE_CLAUDE_CODE=1 to start the real Claude Code";

type Rpc = { jsonrpc: "2.0"; id?: number | string; method?: string; params?: unknown };

function countingServer() {
  const sent = new Map<string, number>();
  const asked: string[] = [];
  const reply = (res: ServerResponse, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(200, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };
  const tools = ["ok", "expired", "unauthorized", "elicit", "drop"].map((name) => ({
    name,
    description: name,
    inputSchema: { type: "object", properties: {} },
  }));
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const rpc = chunks.length ? (JSON.parse(Buffer.concat(chunks).toString()) as Rpc) : null;
    asked.push(`${req.method} ${req.url} ${rpc?.method ?? ""}`.trim());
    if (req.url !== "/mcp" || req.method === "GET") {
      res.writeHead(req.url === "/mcp" ? 405 : 404).end();
      return;
    }
    if (req.method === "DELETE" || !rpc || rpc.id === undefined) {
      res.writeHead(202).end();
      return;
    }
    const answer = (result: unknown) => reply(res, { jsonrpc: "2.0", id: rpc.id, result });
    if (rpc.method === "initialize")
      return reply(
        res,
        {
          jsonrpc: "2.0",
          id: rpc.id,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "counting", version: "1" },
          },
        },
        { "mcp-session-id": `s-${asked.length}` },
      );
    if (rpc.method === "tools/list") return answer({ tools });
    if (rpc.method !== "tools/call") return answer({});
    const tool = String((rpc.params as { name?: unknown }).name);
    sent.set(tool, (sent.get(tool) ?? 0) + 1);
    if (tool === "expired") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: rpc.id,
          error: { code: -32001, message: "Session not found" },
        }),
      );
      return;
    }
    if (tool === "unauthorized") {
      res.writeHead(401, { "www-authenticate": 'Bearer error="invalid_token"' }).end();
      return;
    }
    if (tool === "elicit")
      return reply(res, {
        jsonrpc: "2.0",
        id: rpc.id,
        error: {
          code: -32042,
          message: "This request requires more information.",
          data: {
            elicitations: [
              {
                mode: "url",
                elicitationId: "e-1",
                url: "https://example.com/connect",
                message: "Connect your account",
              },
            ],
          },
        },
      });
    if (tool === "drop") {
      req.socket.destroy();
      return;
    }
    return answer({ content: [{ type: "text", text: "done" }] });
  });
  return { server, sent, asked };
}

test("one mcp_call reaches the server at most once, however it goes wrong", { skip }, async () => {
  const cli = locateClaudeCode(process.env);
  assert.ok(cli, "Claude Code is installed");
  const { server, sent, asked } = countingServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/mcp`;
  const grants = [{ name: "counting", url }];
  const config = mkdtempSync(join(tmpdir(), "oriel-cc-config-"));
  const results: Record<string, string> = {};
  try {
    for (const tool of ["ok", "expired", "unauthorized", "elicit", "drop"]) {
      const host = await openToolHost({
        command: cli,
        args: [
          "--mcp-config",
          JSON.stringify({ mcpServers: { counting: { type: "http", url } } }),
          ...toolHostArgs(grants),
        ],
        env: harnessEnv({ ...process.env, CLAUDE_CONFIG_DIR: config }, 1),
        grants,
        tools: [{ server: "counting", tool }],
        log: () => {},
        callMs: 60_000,
      });
      try {
        const answer = await host.call({ server: "counting", tool, args: {} });
        results[tool] = answer.isError
          ? `error answer: ${JSON.stringify(answer.content).slice(0, 400)}`
          : "answer";
      } catch (error) {
        results[tool] = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      } finally {
        await host.close();
      }
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(config, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ results, asked }, null, 1));
  for (const tool of ["ok", "expired", "unauthorized", "elicit", "drop"])
    assert.equal(sent.get(tool), 1, `${tool} was sent ${sent.get(tool) ?? 0} times`);
});
