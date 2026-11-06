import assert from "node:assert/strict";
import { connect } from "node:net";
import { test } from "node:test";
import { type After, loopback, signInMs } from "./loopback.ts";

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

test("it listens on 127.0.0.1 on a port of its own, and closes after its one redirect", async () => {
  const { listener, timer, port, url } = await listening();
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/");
  assert.ok(port > 0);
  assert.equal(timer.timers.length, 1);
  assert.equal(timer.timers[0]?.ms, signInMs);
  assert.equal(signInMs, 5 * 60_000);

  const answer = await send(port, get(port, `/?code=4/abc&state=${state}&scope=x`));
  assert.equal(status(answer), "200");
  assert.match(answer, /Content-Security-Policy: default-src 'none'/i);
  assert.match(answer, /Referrer-Policy: no-referrer/i);
  const redirect = await listener.redirect;
  assert.equal(redirect.status, "redirected");
  assert.equal(redirect.status === "redirected" && redirect.query.get("code"), "4/abc");
  assert.equal(timer.timers[0]?.cancelled, true);

  // A second request finds nothing listening.
  assert.equal(await send(port, get(port, `/?code=4/def&state=${state}`)), "error ECONNREFUSED");
});

test("a second request on the first's connection gets no answer", async () => {
  const { listener, port } = await listening();
  const first = get(port, `/?code=4/abc&state=${state}`);
  const second = get(port, `/?code=4/def&state=${state}`);
  const answer = await send(port, first + second);
  assert.equal(answer.match(/^HTTP\/1\.1 /gm)?.length, 1);
  const redirect = await listener.redirect;
  assert.equal(redirect.status === "redirected" && redirect.query.get("code"), "4/abc");
});

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

test("a redirect with no state, or two, is refused", async () => {
  for (const query of ["?code=4/abc", `?code=4/abc&state=${state}&state=${state}`]) {
    const { listener, port } = await listening();
    assert.equal(status(await send(port, get(port, `/${query}`))), "400");
    assert.equal((await listener.redirect).status, "refused");
  }
});

test("a request to another path is refused, and ends the sign-in", async () => {
  const { listener, port } = await listening();
  assert.equal(
    status(await send(port, get(port, `/favicon.ico?code=4/abc&state=${state}`))),
    "400",
  );
  assert.deepEqual(await listener.redirect, {
    status: "refused",
    problem: "a request to another path",
  });
  assert.equal(await send(port, get(port, `/?code=4/abc&state=${state}`)), "error ECONNREFUSED");
});

test("a target that isn't a path is refused, and nothing throws", async () => {
  for (const target of [`http://[/?code=4/abc&state=${state}`, `//evil.example/?state=${state}`]) {
    const { listener, port } = await listening();
    assert.equal(
      status(await send(port, `GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`)),
      "400",
    );
    assert.deepEqual(await listener.redirect, {
      status: "refused",
      problem: "a request to another path",
    });
  }
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

test("Google's refusal ends the sign-in, quoting only its error code", async () => {
  const { listener, port } = await listening();
  await send(port, get(port, `/?error=access_denied&state=${state}`));
  assert.deepEqual(await listener.redirect, {
    status: "refused",
    problem: "Google said access_denied",
  });
  const odd = await listening();
  await send(odd.port, get(odd.port, `/?error=%3Cscript%3E&state=${state}`));
  assert.deepEqual(await odd.listener.redirect, { status: "refused", problem: "Google refused" });
});

test("a redirect with no code is refused", async () => {
  const { listener, port } = await listening();
  await send(port, get(port, `/?state=${state}`));
  assert.deepEqual(await listener.redirect, {
    status: "refused",
    problem: "a redirect with no code",
  });
});

test("with no request in 5 minutes it times out and closes", async () => {
  const { listener, timer, port } = await listening();
  timer.timers[0]?.fire();
  assert.deepEqual(await listener.redirect, { status: "timed-out" });
  assert.equal(await send(port, get(port, `/?code=4/abc&state=${state}`)), "error ECONNREFUSED");
});

test("closing it stops listening", async () => {
  const { listener, timer, port } = await listening();
  listener.close();
  assert.equal((await listener.redirect).status, "refused");
  assert.equal(timer.timers[0]?.cancelled, true);
  assert.equal(await send(port, get(port, `/?code=4/abc&state=${state}`)), "error ECONNREFUSED");
});
