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

test("a message a line, split anywhere across chunks, with CRLF or not, and a last line unended", async () => {
  const whole = line(1, { word: "héllo" }) + line(2).replace("\n", "\r\n") + "\n" + line(3).trim();
  const bytes = Buffer.from(whole);
  // Split inside the two bytes of `é`.
  const at = bytes.indexOf(Buffer.from("é")) + 1;
  assert.deepEqual(
    await serve(echo(), [bytes.subarray(0, 20), bytes.subarray(20, at), bytes.subarray(at)]),
    [
      { jsonrpc: "2.0", id: 1, result: { got: { word: "héllo" } } },
      { jsonrpc: "2.0", id: 2, result: { got: null } },
      { jsonrpc: "2.0", id: 3, result: { got: null } },
    ],
  );
});

test("a line that isn't JSON gets a parse error, and the next is still read", async () => {
  assert.deepEqual(await serve(echo(), ["{nope\n", line(5)]), [
    { jsonrpc: "2.0", id: null, error: { code: codes.parse, message: "Parse error" } },
    { jsonrpc: "2.0", id: 5, result: { got: null } },
  ]);
});

test("a line longer than the most is dropped whole, once, and what follows is read", async () => {
  const long = "x".repeat(lineMost + 10);
  const answers = await serve(echo(), [
    long.slice(0, lineMost / 2),
    long.slice(lineMost / 2),
    "tail\n",
    line(6),
  ]);
  assert.deepEqual(answers, [
    {
      jsonrpc: "2.0",
      id: null,
      error: { code: codes.invalidRequest, message: "Message too long" },
    },
    { jsonrpc: "2.0", id: 6, result: { got: null } },
  ]);
});

test("answers go out as they finish, and the input's end waits for them all", async () => {
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const server = echo(async (id) => {
    if (id === 1) await held;
  });
  const order: number[] = [];
  const done = serveStdio(server, [line(1), line(2)], {
    write: (t) => {
      order.push((JSON.parse(t) as { id: number }).id);
      if (order.length === 1) release();
    },
  });
  await done;
  assert.deepEqual(order, [2, 1]);
});

test("a server that throws answers an internal error, with the request's ID", async () => {
  const server: McpServer = {
    handle: async () => {
      throw new Error("boom");
    },
  };
  assert.deepEqual(await serve(server, [line(8)]), [
    { jsonrpc: "2.0", id: 8, error: { code: codes.internal, message: "Internal error" } },
  ]);
});
