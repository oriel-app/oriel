import assert from "node:assert/strict";
import { test } from "node:test";
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
    await assert.rejects(transport(write));
  assert.deepEqual(sent, ["GET /rest/api/3/myself", "POST /rest/api/3/search/jql"]);
});
