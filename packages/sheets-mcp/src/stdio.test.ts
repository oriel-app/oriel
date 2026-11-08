import assert from "node:assert/strict";
import { test } from "node:test";
import { codes, type McpServer } from "./server.ts";
import { lineMost, serveStdio } from "./stdio.ts";

// A server that answers each request with its own params, after `wait`.
function echo(wait: (id: unknown) => Promise<void> = async () => {}): McpServer {
  return {
    handle: async (message) => {
      const m = message as { id?: number; params?: unknown };
      if (m.id === undefined) return null;
      await wait(m.id);
      return { jsonrpc: "2.0", id: m.id, result: { got: m.params ?? null } };
    },
  };
}

async function serve(server: McpServer, chunks: (string | Buffer)[]) {
  const lines: unknown[] = [];
  let text = "";
  await serveStdio(server, chunks, { write: (t) => (text += t) });
  for (const line of text.split("\n").slice(0, -1)) lines.push(JSON.parse(line));
  assert.ok(text === "" || text.endsWith("\n"));
  return lines;
}

const line = (id: number, params?: unknown) =>
  `${JSON.stringify({ jsonrpc: "2.0", id, method: "x", ...(params === undefined ? {} : { params }) })}\n`;

test("a line longer than the most is dropped whole, once, and what follows is read", async () => {
  const long = "x".repeat(lineMost + 10);
  const answers = await serve(echo(), [
    long.slice(0, lineMost / 2),
    long.slice(lineMost / 2),
    "tail\n",
    line(6),
  ]);
  // One invalid-request error, with no ID to answer (the line had none it
  // could read), then the next request answered.
  const [dropped, next, ...more] = answers as {
    jsonrpc: string;
    id: unknown;
    error?: { code: number };
  }[];
  assert.equal(dropped?.jsonrpc, "2.0");
  assert.equal(dropped?.id, null);
  assert.equal(dropped?.error?.code, codes.invalidRequest);
  assert.deepEqual(next, { jsonrpc: "2.0", id: 6, result: { got: null } });
  assert.deepEqual(more, []);
});
