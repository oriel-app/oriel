import assert from "node:assert/strict";
import { test } from "node:test";
import { WriteStalled } from "@oriel/core";
import { type Exchange, recording, replay } from "./cassette.ts";
import { basicAuth, readOnly, restTransport, type Transport, withinLimit } from "./transport.ts";

const site = "https://oriel.atlassian.net";

// A fetch that answers from a list and keeps what it was sent.
function fetchFrom(...responses: Response[]) {
  const sent: { url: string; init: RequestInit }[] = [];
  const fake = async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    return next;
  };
  return { fetch: fake as typeof fetch, sent };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

test("basic auth is the email and token, base64'd, and only in a header", async () => {
  const credential = basicAuth("pm@example.com", "secret-token");
  assert.deepEqual(await credential.headers(), {
    Authorization: `Basic ${Buffer.from("pm@example.com:secret-token").toString("base64")}`,
  });
  assert.ok(!JSON.stringify(credential).includes("secret-token"));
});

test("a request goes to the site with the credential's headers and a JSON body", async () => {
  const { fetch, sent } = fetchFrom(json({ issues: [] }), new Response(null, { status: 204 }));
  const transport = restTransport({ site, credential: basicAuth("a@example.com", "t"), fetch });
  const answer = await transport({
    method: "POST",
    path: "/rest/api/3/search/jql",
    body: { jql: "project = SYN" },
  });
  assert.deepEqual(answer, { status: 200, body: { issues: [] } });
  assert.equal(sent[0]?.url, `${site}/rest/api/3/search/jql`);
  assert.equal(sent[0]?.init.method, "POST");
  assert.equal(sent[0]?.init.body, '{"jql":"project = SYN"}');
  const headers = sent[0]?.init.headers as Record<string, string>;
  assert.match(headers.Authorization ?? "", /^Basic /);
  assert.equal(headers["Content-Type"], "application/json");
  assert.deepEqual(await transport({ method: "DELETE", path: "/rest/api/3/issue/SYN-1" }), {
    status: 204,
    body: null,
  });
  assert.equal(
    ((sent[1]?.init.headers ?? {}) as Record<string, string>)["Content-Type"],
    undefined,
  );
});

test("rate limits are retried after Retry-After; a 503 only for reads", async () => {
  const waits: number[] = [];
  const wait = async (ms: number) => void waits.push(ms);
  const credential = basicAuth("a@example.com", "t");
  const limited = () => json({}, 429, { "Retry-After": "2" });
  const first = fetchFrom(limited(), json({}, 503), json({ ok: true }));
  const read = restTransport({ site, credential, fetch: first.fetch, wait });
  assert.deepEqual(await read({ method: "GET", path: "/rest/api/3/myself" }), {
    status: 200,
    body: { ok: true },
  });
  assert.deepEqual(waits, [2000, 5000]);

  const second = fetchFrom(json({}, 503));
  const write = restTransport({ site, credential, fetch: second.fetch, wait });
  const answer = await write({ method: "POST", path: "/rest/api/3/issue", body: {} });
  assert.equal(answer.status, 503);
  assert.equal(second.sent.length, 1);

  const third = fetchFrom(...Array.from({ length: 5 }, limited));
  const stubborn = restTransport({ site, credential, fetch: third.fetch, wait });
  assert.equal((await stubborn({ method: "GET", path: "/rest/api/3/myself" })).status, 429);
  assert.equal(third.sent.length, 5);
});

// A write's limit on a fake clock: it has until `until`, and each wait moves
// the clock on by as long as it waits.
function clock(until: number) {
  const time = { now: 0 };
  const waits: number[] = [];
  const timeouts: number[] = [];
  return {
    time,
    waits,
    timeouts,
    limit: { left: () => until - time.now },
    wait: async (ms: number) => {
      waits.push(ms);
      time.now += ms;
    },
    // Each request's timeout, which only the test fires.
    timeout: (ms: number) => {
      timeouts.push(ms);
      return new AbortController().signal;
    },
  };
}

test("a write's requests keep within its limit, and a Retry-After past it stalls the write", async () => {
  const credential = basicAuth("a@example.com", "t");
  const put = { method: "PUT", path: "/rest/api/3/issue/SYN-1", body: {} } as const;
  const c = clock(120_000);
  const first = fetchFrom(json({}, 429, { "Retry-After": "10" }), json({ ok: true }));
  const write = restTransport({
    site,
    credential,
    fetch: first.fetch,
    wait: c.wait,
    timeout: c.timeout,
  });
  // Asked to wait 10 s with 120 s left, it waits, then goes again.
  assert.equal((await withinLimit(c.limit, () => write(put))).status, 200);
  assert.deepEqual([c.waits, c.timeouts], [[10_000], [30_000, 30_000]]);
  // With 20 s left, a request gets 20 s, not its own 30.
  c.time.now = 100_000;
  const second = fetchFrom(json({ ok: true }));
  const late = restTransport({ site, credential, fetch: second.fetch, timeout: c.timeout });
  assert.equal((await withinLimit(c.limit, () => late(put))).status, 200);
  assert.equal(c.timeouts.at(-1), 20_000);
  // Asked to wait 600 s, it stalls at once: no wait, and nothing sent again.
  c.time.now = 0;
  const third = fetchFrom(json({}, 429, { "Retry-After": "600" }));
  const stalled = restTransport({
    site,
    credential,
    fetch: third.fetch,
    wait: c.wait,
    timeout: c.timeout,
  });
  await assert.rejects(
    withinLimit(c.limit, () => stalled(put)),
    (error) => error instanceof WriteStalled && /wait 600 seconds/.test(error.message),
  );
  assert.deepEqual([third.sent.length, c.waits], [1, [10_000]]);
  // With no time left, nothing goes out.
  c.time.now = 120_000;
  const fourth = fetchFrom(json({ ok: true }));
  const over = restTransport({ site, credential, fetch: fourth.fetch, timeout: c.timeout });
  await assert.rejects(
    withinLimit(c.limit, () => over(put)),
    WriteStalled,
  );
  assert.equal(fourth.sent.length, 0);
  // A read for no write keeps its own timeout, and any Retry-After.
  const fifth = fetchFrom(json({}, 429, { "Retry-After": "600" }), json({ ok: true }));
  const read = restTransport({
    site,
    credential,
    fetch: fifth.fetch,
    wait: c.wait,
    timeout: c.timeout,
  });
  assert.equal((await read({ method: "GET", path: "/rest/api/3/myself" })).status, 200);
  assert.deepEqual([c.waits.at(-1), c.timeouts.at(-1)], [60_000, 30_000]);
});

test("a hung request is given up on when its write's time runs out", async () => {
  const c = clock(20_000);
  const signals: AbortController[] = [];
  const timeout = (ms: number) => {
    c.timeouts.push(ms);
    const controller = new AbortController();
    signals.push(controller);
    return controller.signal;
  };
  // A fetch that never answers, until its request is aborted.
  const sent = Promise.withResolvers<void>();
  const hung = ((_url: string | URL | Request, init?: RequestInit) => {
    sent.resolve();
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    });
  }) as typeof fetch;
  const write = restTransport({
    site,
    credential: basicAuth("a@example.com", "t"),
    fetch: hung,
    timeout,
  });
  const sending = withinLimit(c.limit, () =>
    write({ method: "POST", path: "/rest/api/3/issue", body: {} }),
  );
  await sent.promise;
  assert.deepEqual(c.timeouts, [20_000]);
  // Its 20 s run out.
  c.time.now = 20_000;
  signals[0]?.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
  await assert.rejects(sending, { name: "TimeoutError" });
});

test("only https origins and /rest/ paths are accepted", async () => {
  const credential = basicAuth("a@example.com", "t");
  for (const bad of ["http://oriel.atlassian.net", "https://oriel.atlassian.net/wiki", "nope"])
    assert.throws(() => restTransport({ site: bad, credential }), RangeError);
  const { fetch, sent } = fetchFrom();
  const transport = restTransport({ site: `${site}/`, credential, fetch });
  for (const path of [
    "//evil.example/rest/api/3/myself",
    "/wiki/api",
    "https://evil.example/rest/",
  ])
    await assert.rejects(transport({ method: "GET", path }), RangeError);
  assert.equal(sent.length, 0);
});

test("a cassette replays what was recorded and refuses anything else", async () => {
  const exchanges: Exchange[] = [];
  const live = recording(
    async (request) => ({ status: 200, body: { echo: request.path } }),
    exchanges,
  );
  await live({ method: "GET", path: "/rest/api/3/myself" });
  await live({ method: "POST", path: "/rest/api/3/search/jql", body: { jql: "a" } });
  const replayed = replay(JSON.parse(JSON.stringify(exchanges)) as Exchange[]);
  assert.deepEqual(await replayed({ method: "GET", path: "/rest/api/3/myself" }), {
    status: 200,
    body: { echo: "/rest/api/3/myself" },
  });
  await assert.rejects(
    replayed({ method: "POST", path: "/rest/api/3/search/jql", body: { jql: "b" } }),
    /not in the cassette/,
  );
});

test("the read side sends only reads, even through a cast", async () => {
  const sent: string[] = [];
  const read = readOnly(async (request) => {
    sent.push(`${request.method} ${request.path}`);
    return { status: 200, body: null };
  });
  const transport = read as Transport;
  await transport({ method: "GET", path: "/rest/api/3/myself" });
  await transport({ method: "POST", path: "/rest/api/3/search/jql", body: {} });
  for (const write of [
    { method: "POST" as const, path: "/rest/api/3/issue" },
    { method: "POST" as const, path: "/rest/api/3/search/jql/../../issue" },
    { method: "PUT" as const, path: "/rest/api/3/issue/SYN-1" },
    { method: "DELETE" as const, path: "/rest/api/3/issue/SYN-1" },
  ])
    await assert.rejects(transport(write), /refusing a write on the read side/);
  assert.deepEqual(sent, ["GET /rest/api/3/myself", "POST /rest/api/3/search/jql"]);
});
