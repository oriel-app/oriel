// OA-244: a client that left before the server attached its close listener
// kept the stream's watchers forever, and one that left while the server
// waited for it to read hung the send loop. Either way now the stream ends
// and `send` returns.
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, request, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { send } from "./serve.ts";
import { channel } from "./stream.ts";

// A server whose one request `answer` takes, and a client that asks it.
async function served(answer: (res: ServerResponse) => Promise<void>) {
  const server = createServer((_req, res) => void answer(res));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const client = request({ port: (server.address() as AddressInfo).port, host: "127.0.0.1" });
  client.on("error", () => {});
  client.end();
  return { client, close: () => server.close() };
}

test("a stream whose client left before its reply was ready lets go, and its send ends", async () => {
  let ended = false;
  const { iterator } = channel<string>(() => {
    ended = true;
  });
  const { promise: arrived, resolve: arrive } = Promise.withResolvers<void>();
  const { promise: sent, resolve: sending } = Promise.withResolvers<Promise<void>>();
  const { client, close } = await served(async (res) => {
    arrive();
    await once(res, "close");
    sending(send(res, "GET", { status: 200, headers: {}, body: "", stream: iterator }));
  });
  await arrived;
  client.destroy();
  await await sent;
  assert.equal(ended, true);
  close();
});

test("a stream whose client leaves while it waits for the client to read lets go, and its send ends", async () => {
  let ended = false;
  const events = channel<string>(() => {
    ended = true;
  });
  let sent!: Promise<void>;
  const { client, close } = await served(async (res) => {
    sent = send(res, "GET", { status: 200, headers: {}, body: "", stream: events.iterator });
    // More than the socket holds, which the client never reads.
    events.push("x".repeat(16 * 1024 * 1024));
  });
  const [response] = await once(client, "response");
  response.pause();
  client.destroy();
  await sent;
  assert.equal(ended, true);
  close();
});
