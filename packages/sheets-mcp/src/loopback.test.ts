import assert from "node:assert/strict";
import { connect } from "node:net";
import { test } from "node:test";
import { type After, loopback } from "./loopback.ts";

const state = "this-sign-ins-state-0123456789abcdefghijklm";

function fakeTimer() {
  const timers: { ms: number; fire: () => void; cancelled: boolean }[] = [];
  const after: After = (ms, fire) => {
    const timer = { ms, fire, cancelled: false };
    timers.push(timer);
    return () => (timer.cancelled = true);
  };
  return { after, timers };
}

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

const echoes = (text: string) => /4\/abc|someone-elses|this-sign-ins-state/.test(text);

test("a redirect with the wrong state is refused, and ends the sign-in", async () => {
  const { listener, port } = await listening();
  const answer = await send(port, get(port, "/?code=4/abc&state=someone-elses"));
  assert.equal(status(answer), "400");
  assert.ok(!echoes(answer));
  const redirect = await listener.redirect;
  assert.equal(redirect.status, "refused");
  assert.ok(!echoes(JSON.stringify(redirect)));
  assert.equal(await send(port, get(port, `/?code=4/abc&state=${state}`)), "error ECONNREFUSED");
});

test("a request naming another host, or not a GET, is refused", async () => {
  const query = `/?code=4/abc&state=${state}`;
  const rebound = await listening();
  const host = `evil.example:${rebound.port}`;
  const posted = await listening();
  const post = `POST ${query} HTTP/1.1\r\nHost: 127.0.0.1:${posted.port}\r\nContent-Length: 0\r\n\r\n`;
  for (const [{ listener, port }, request] of [
    [rebound, get(rebound.port, query, host)],
    [posted, post],
  ] as const) {
    const answer = await send(port, request);
    assert.equal(status(answer), "400");
    assert.ok(!echoes(answer));
    const redirect = await listener.redirect;
    assert.equal(redirect.status, "refused");
    assert.ok(!echoes(JSON.stringify(redirect)));
    assert.equal(await send(port, get(port, query)), "error ECONNREFUSED");
  }
});
