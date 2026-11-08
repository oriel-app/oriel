import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { anthropicProvider } from "@oriel/agent";
import { anthropicFetch, apiVersion, type Fetch, messagesUrl } from "./anthropic.ts";
import { cassettes } from "./cassette.ts";
import { message, streamed, tempDir } from "./testing.ts";

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

test("a cassette stores the request body and no headers, so no API key lands in it", async (t) => {
  const dir = tempDir(t);
  const net = network();
  // As `pnpm evals` composes them: the key is added below the cassettes.
  const tape = cassettes({
    mode: "record",
    dir,
    live: anthropicFetch("sk-ant-api03-LIVEKEY", net.fetch),
  });
  await tape.fetch(
    messagesUrl,
    post(body, {
      authorization: "Bearer sk-ant-oat01-CALLERTOKEN",
      "x-api-key": "sk-ant-api03-CALLERKEY",
    }),
  );
  tape.commit();
  assert.equal(net.seen[0]?.headers.get("x-api-key"), "sk-ant-api03-LIVEKEY");

  const [name] = readdirSync(dir);
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
  assert.deepEqual(Object.keys(stored.response), ["status", "body"]);
});

// OA-122 (#119): evals sent an API version of their own, not the server's.
test("evals send the API version the server sends", async () => {
  const net = network(() => streamed({ text: "Hi." }));
  const live = anthropicFetch("sk-ant-api03-LIVEKEY", net.fetch);
  let server: string | null = null;
  const conversation = anthropicProvider({
    apiKey: "not-a-key",
    fetch: (input, init) => {
      server = new Request(input, init).headers.get("anthropic-version");
      return live(input, init);
    },
  }).converse({
    system: "",
    tools: [],
    messages: [{ role: "user", text: "Hi" }],
    signal: new AbortController().signal,
    log: () => {},
  });
  for await (const _ of conversation.next([], { maxOutputTokens: 64 }));
  assert.ok(server);
  assert.equal(net.seen[0]?.headers.get("anthropic-version"), server);
  assert.equal(server, apiVersion);
});

test("the key reaches only the Messages API, and cassettes hold only its requests", async (t) => {
  const net = network();
  const live = anthropicFetch("sk-ant-api03-LIVEKEY", net.fetch);
  await assert.rejects(live("https://example.com/v1/messages", post(body)));
  await assert.rejects(live("https://api.anthropic.com/v1/models"));
  assert.equal(net.seen.length, 0);
  const { fetch } = cassettes({ mode: "record", dir: tempDir(t), live });
  await assert.rejects(fetch("https://example.com/v1/messages", post(body)));
  assert.equal(net.seen.length, 0);
});
