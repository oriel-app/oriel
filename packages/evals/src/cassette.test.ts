import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { anthropicFetch, anthropicKey, apiVersion, type Fetch, messagesUrl } from "./anthropic.ts";
import { cassetteFetch } from "./cassette.ts";
import { message, tempDir, textOf } from "./testing.ts";

const body = {
  model: "claude-opus-5-5",
  max_tokens: 64,
  messages: [{ role: "user", content: "Which epic is SYN-45 in?" }],
};

const post = (value: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(value),
});

// A stand-in for the network that answers each request with `answer()` and
// keeps the requests it saw.
function network(answer: () => Response = () => message("SYN-45 is in SYN-3.")) {
  const seen: Request[] = [];
  const fetch: Fetch = async (input, init) => {
    seen.push(new Request(input, init));
    return answer();
  };
  return { fetch, seen };
}

const files = (dir: URL) => (existsSync(dir) ? readdirSync(dir) : []);

test("a recorded exchange replays offline, whatever the headers or key order", async (t) => {
  const dir = tempDir(t);
  const live = network();
  const recorder = cassetteFetch({ mode: "record", dir, live: live.fetch });
  const recorded = await recorder(messagesUrl, post(body));
  assert.equal(await textOf(recorded), "SYN-45 is in SYN-3.");
  assert.equal(live.seen.length, 1);

  const player = cassetteFetch({ mode: "replay", dir });
  const reordered = { messages: body.messages, max_tokens: 64, model: "claude-opus-5-5" };
  const replayed = await player(messagesUrl, post(reordered, { "anthropic-beta": "some-beta" }));
  assert.equal(replayed.status, 200);
  assert.equal(replayed.headers.get("content-type"), "application/json");
  assert.equal(await textOf(replayed), "SYN-45 is in SYN-3.");
  assert.equal(live.seen.length, 1);
});

test("a cassette stores the request body and no headers, so no API key lands in it", async (t) => {
  const dir = tempDir(t);
  const net = network();
  // As `pnpm evals` composes them: the key is added below the cassettes.
  const recorder = cassetteFetch({
    mode: "record",
    dir,
    live: anthropicFetch("sk-ant-api03-LIVEKEY", net.fetch),
  });
  await recorder(
    messagesUrl,
    post(body, {
      authorization: "Bearer sk-ant-oat01-CALLERTOKEN",
      "x-api-key": "sk-ant-api03-CALLERKEY",
    }),
  );
  assert.equal(net.seen[0]?.headers.get("x-api-key"), "sk-ant-api03-LIVEKEY");
  assert.equal(net.seen[0]?.headers.get("anthropic-version"), apiVersion);

  const [name] = files(dir);
  const text = readFileSync(new URL(name ?? "", dir), "utf8");
  for (const secret of [
    "LIVEKEY",
    "CALLERTOKEN",
    "CALLERKEY",
    "sk-ant",
    "x-api-key",
    "authorization",
  ])
    assert.equal(text.toLowerCase().includes(secret.toLowerCase()), false, secret);
  const stored = JSON.parse(text);
  assert.deepEqual(Object.keys(stored), ["request", "response"]);
  assert.deepEqual(stored.request, { method: "POST", url: messagesUrl, body });
  assert.deepEqual(Object.keys(stored.response), ["status", "body"]);
});

test("replay fails clearly when a cassette is missing", async (t) => {
  const dir = tempDir(t);
  const player = cassetteFetch({ mode: "replay", dir });
  await assert.rejects(
    player(messagesUrl, post(body)),
    /^Error: no cassette for this claude-opus-5-5 request: .*\/[0-9a-f]{64}\.json is missing\. The request changed or was never recorded; record it with `pnpm evals`\.$/,
  );
});

test("a cassette whose request doesn't match its name is refused", async (t) => {
  const dir = tempDir(t);
  await cassetteFetch({ mode: "record", dir, live: network().fetch })(messagesUrl, post(body));
  const file = new URL(files(dir)[0] ?? "", dir);
  writeFileSync(file, readFileSync(file, "utf8").replace("Which epic", "Which story"));
  await assert.rejects(
    cassetteFetch({ mode: "replay", dir })(messagesUrl, post(body)),
    /holds a different request than its name says/,
  );
});

test("a failed response passes through and is never recorded", async (t) => {
  const dir = tempDir(t);
  const live = network(() => new Response("rate limited", { status: 429 }));
  const response = await cassetteFetch({ mode: "record", dir, live: live.fetch })(
    messagesUrl,
    post(body),
  );
  assert.equal(response.status, 429);
  assert.equal(await response.text(), "rate limited");
  assert.deepEqual(files(dir), []);
});

test("a streamed response is stored as text and replays as an event stream", async (t) => {
  const dir = tempDir(t);
  const events = 'event: message_stop\ndata: {"type":"message_stop"}\n\n';
  const live = network(
    () => new Response(events, { headers: { "content-type": "text/event-stream" } }),
  );
  const streamed = { ...body, stream: true };
  await cassetteFetch({ mode: "record", dir, live: live.fetch })(messagesUrl, post(streamed));
  const replayed = await cassetteFetch({ mode: "replay", dir })(messagesUrl, post(streamed));
  assert.equal(replayed.headers.get("content-type"), "text/event-stream");
  assert.equal(await replayed.text(), events);
});

test("only Messages API requests get through, recorded or live", async (t) => {
  const dir = tempDir(t);
  const recorder = cassetteFetch({ mode: "record", dir, live: network().fetch });
  await assert.rejects(recorder("https://api.anthropic.com/v1/models"), /hold only POST/);
  await assert.rejects(recorder("https://example.com/v1/messages", post(body)), /hold only POST/);
  await assert.rejects(recorder(messagesUrl, { method: "POST", body: "not json" }), /must be JSON/);
  const live = anthropicFetch("sk-ant-api03-LIVEKEY", network().fetch);
  await assert.rejects(live("https://example.com/v1/messages", post(body)), /reach only POST/);
});

test("a committed cassette still replays: the key is stable", async () => {
  const dir = new URL("../../../tests/cassettes/_unit/", import.meta.url);
  const replayed = await cassetteFetch({ mode: "replay", dir })(messagesUrl, post(body));
  assert.equal(await textOf(replayed), "SYN-45 is in SYN-3.");
});

test("the API key comes from ANTHROPIC_API_KEY alone", () => {
  assert.equal(
    anthropicKey("JIRA_API_TOKEN=x\nANTHROPIC_API_KEY=sk-ant-api03-abc\n"),
    "sk-ant-api03-abc",
  );
  assert.equal(anthropicKey("ANTHROPIC_API_KEY=\n"), null);
  assert.equal(anthropicKey("GH_TOKEN=github_pat_x\n"), null);
  assert.equal(anthropicKey(null), null);
});
