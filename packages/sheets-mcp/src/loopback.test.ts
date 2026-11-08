import assert from "node:assert/strict";
import { connect } from "node:net";
import { test } from "node:test";
import { type After, loopback } from "./loopback.ts";

const state = "this-sign-ins-state-0123456789abcdefghijklm";

// A clock that never fires on its own: a test fires it.
function fakeTimer() {
  const timers: { ms: number; fire: () => void; cancelled: boolean }[] = [];
  const after: After = (ms, fire) => {
    const timer = { ms, fire, cancelled: false };
    timers.push(timer);
    return () => (timer.cancelled = true);
  };
  return { after, timers };
}

// Sends raw HTTP and resolves with everything answered before the connection
// closed, or the connection's error code.
function send(port: number, text: string): Promise<string> {
  return new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1");
    let got = "";
    socket.on("connect", () => socket.write(text));
    socket.on("data", (chunk) => (got += chunk));
    socket.on("close", () => resolve(got));
    socket.on("error", (error: NodeJS.ErrnoException) => resolve(`error ${error.code}`));
  });
}

const get = (port: number, path: string, host = `127.0.0.1:${port}`) =>
  `GET ${path} HTTP/1.1\r\nHost: ${host}\r\n\r\n`;

const status = (answer: string) => /^HTTP\/1\.1 (\d+)/.exec(answer)?.[1] ?? answer;

async function listening() {
  const timer = fakeTimer();
  const listener = await loopback(state, timer.after);
  const url = new URL(listener.redirectUri);
  return { listener, timer, port: Number(url.port), url };
}

test("a redirect with the wrong state is refused, and ends the sign-in", async () => {
  const { listener, port } = await listening();
  const answer = await send(port, get(port, "/?code=4/abc&state=someone-elses"));
  assert.equal(status(answer), "400");
  assert.doesNotMatch(answer, /someone-elses|4\/abc/);
  assert.deepEqual(await listener.redirect, {
    status: "refused",
    problem: "a redirect whose state isn't this sign-in's",
  });
  assert.equal(await send(port, get(port, `/?code=4/abc&state=${state}`)), "error ECONNREFUSED");
});

test("a request naming another host, or not a GET, is refused", async () => {
  const rebound = await listening();
  const query = `/?code=4/abc&state=${state}`;
  const answer = await send(rebound.port, get(rebound.port, query, `evil.example:${rebound.port}`));
  assert.equal(status(answer), "400");
  assert.deepEqual(await rebound.listener.redirect, {
    status: "refused",
    problem: "a request for another host",
  });

  const posted = await listening();
  const post = `POST ${query} HTTP/1.1\r\nHost: 127.0.0.1:${posted.port}\r\nContent-Length: 0\r\n\r\n`;
  assert.equal(status(await send(posted.port, post)), "400");
  assert.equal((await posted.listener.redirect).status, "refused");
});
