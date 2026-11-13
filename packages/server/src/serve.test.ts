// Defect fixed in #281: a client that left early kept its stream's watchers,
// or hung `send` waiting for drain.
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, request, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { send } from "./serve.ts";
import { channel } from "./stream.ts";

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
  const { promise: sent, resolve: sending } = Promise.withResolvers<void>();
  const { client, close } = await served(async (res) => {
    arrive();
    await once(res, "close");
    sending(send(res, "GET", { status: 200, headers: {}, body: "", stream: iterator }));
  });
  await arrived;
  client.destroy();
  await sent;
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
    // More than the socket buffers, so `send` waits for drain.
    events.push("x".repeat(16 * 1024 * 1024));
  });
  const [response] = await once(client, "response");
  response.pause();
  client.destroy();
  await sent;
  assert.equal(ended, true);
  close();
});
