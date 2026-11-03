// The Web API transport, against a fetch that answers from memory.
import assert from "node:assert/strict";
import { test } from "node:test";
import { WriteStalled } from "@oriel/core";
import { bearer, type ReadMethod, SlackError, webApi, withinLimit } from "./api.ts";

type Sent = { url: string; headers: Record<string, string>; body: string };

function fakeFetch(answers: Response[]) {
  const sent: Sent[] = [];
  const send: typeof fetch = async (input, init) => {
    sent.push({
      url: String(input),
      headers: init?.headers as Record<string, string>,
      body: String(init?.body),
    });
    const answer = answers.shift();
    if (!answer) throw new Error("no more answers");
    return answer;
  };
  return { send, sent };
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" }, ...init });

test("a call posts its arguments as a form to slack.com, with the token as a bearer", async () => {
  const { send, sent } = fakeFetch([json({ ok: true, channel: { id: "C0A", name: "a" } })]);
  const api = webApi({ credential: bearer("xoxp-test"), fetch: send });
  assert.deepEqual(await api("conversations.info", { channel: "C0A" }), {
    ok: true,
    channel: { id: "C0A", name: "a" },
  });
  assert.equal(sent[0]?.url, "https://slack.com/api/conversations.info");
  assert.equal(sent[0]?.headers.Authorization, "Bearer xoxp-test");
  assert.equal(sent[0]?.body, "channel=C0A");
});

test("Slack's error code comes back as a SlackError", async () => {
  const { send } = fakeFetch([json({ ok: false, error: "channel_not_found" })]);
  const api = webApi({ credential: bearer("xoxp-test"), fetch: send });
  await assert.rejects(
    api("conversations.history", { channel: "C0A" }),
    (error) => error instanceof SlackError && error.code === "channel_not_found",
  );
});

test("a 429 waits as long as Retry-After says, then tries again", async () => {
  const { send, sent } = fakeFetch([
    new Response("", { status: 429, headers: { "Retry-After": "3" } }),
    json({ ok: true, messages: [] }),
  ]);
  const waits: number[] = [];
  const api = webApi({
    credential: bearer("xoxp-test"),
    fetch: send,
    wait: async (ms) => waits.push(ms),
  });
  assert.deepEqual(await api("conversations.history", { channel: "C0A" }), {
    ok: true,
    messages: [],
  });
  assert.deepEqual(waits, [3000]);
  assert.equal(sent.length, 2);
});

test("a write's call gets only what is left of it, and a Retry-After past that stalls it", async () => {
  // A fake clock: the write has 120 s, and each wait moves the clock on.
  const time = { now: 0 };
  const limit = { left: () => 120_000 - time.now };
  const waits: number[] = [];
  const timeouts: number[] = [];
  const options = {
    credential: bearer("xoxp-test"),
    wait: async (ms: number) => {
      waits.push(ms);
      time.now += ms;
    },
    timeout: (ms: number) => {
      timeouts.push(ms);
      return new AbortController().signal;
    },
  };
  const first = fakeFetch([
    new Response("", { status: 429, headers: { "Retry-After": "100" } }),
    json({ ok: true, messages: [] }),
  ]);
  const api = webApi({ ...options, fetch: first.send });
  await withinLimit(limit, () => api("conversations.history", { channel: "C0A" }));
  // It waited 60 s, Slack's 100 capped, and went again with 60 s left.
  assert.deepEqual([waits, timeouts], [[60_000], [30_000, 30_000]]);
  time.now = 110_000;
  const second = fakeFetch([new Response("", { status: 429, headers: { "Retry-After": "30" } })]);
  const later = webApi({ ...options, fetch: second.send });
  await assert.rejects(
    withinLimit(limit, () => later("conversations.history", { channel: "C0A" })),
    (error) => error instanceof WriteStalled && /wait 30 seconds/.test(error.message),
  );
  assert.deepEqual([timeouts.at(-1), waits.length, second.sent.length], [10_000, 1, 1]);
});

test("a reply that isn't Slack's fails without echoing it", async () => {
  const { send } = fakeFetch([new Response("<html>bad gateway</html>", { status: 502 })]);
  const api = webApi({ credential: bearer("xoxp-test"), fetch: send });
  await assert.rejects(api("auth.test", {}), /^Error: auth\.test: 502, not a Slack reply$/);
});

test("only read methods go out, whatever a cast says", async () => {
  const { send, sent } = fakeFetch([json({ ok: true })]);
  const api = webApi({ credential: bearer("xoxp-test"), fetch: send });
  await assert.rejects(
    api("chat.postMessage" as ReadMethod, { channel: "C0A", text: "hi" }),
    /refusing a method the read side doesn't use: chat\.postMessage/,
  );
  assert.equal(sent.length, 0);
});

test("a credential that fails sends nothing, and its message stays out of the error", async () => {
  const { send, sent } = fakeFetch([]);
  const api = webApi({
    credential: { headers: () => Promise.reject(new Error("xoxp-secret expired")) },
    fetch: send,
  });
  await assert.rejects(api("auth.test", {}), (error: Error) => {
    assert.equal(error.message, "Oriel couldn't get its credentials for Slack");
    return true;
  });
  assert.equal(sent.length, 0);
});
