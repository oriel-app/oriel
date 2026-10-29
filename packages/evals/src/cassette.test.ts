import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import {
  anthropicFetch,
  anthropicKey,
  apiVersion,
  type Fetch,
  messagesUrl,
  responseModel,
  sameModel,
} from "./anthropic.ts";
import { cassetteDir, cassettes } from "./cassette.ts";
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

const files = (dir: URL) => (existsSync(dir) ? readdirSync(dir).sort() : []);

// Records one request, as a case that finished without error would.
async function recordOne(dir: URL, live: Fetch, request: unknown = body): Promise<Response> {
  const tape = cassettes({ mode: "record", dir, live });
  const response = await tape.fetch(messagesUrl, post(request));
  tape.commit();
  return response;
}

const replayOne = (dir: URL, request: unknown = body, headers: Record<string, string> = {}) =>
  cassettes({ mode: "replay", dir }).fetch(messagesUrl, post(request, headers));

test("a recorded exchange replays offline, whatever the headers or key order", async (t) => {
  const dir = tempDir(t);
  const live = network();
  assert.equal(await textOf(await recordOne(dir, live.fetch)), "SYN-45 is in SYN-3.");
  assert.equal(live.seen.length, 1);

  const reordered = { messages: body.messages, max_tokens: 64, model: "claude-opus-5-5" };
  const replayed = await replayOne(dir, reordered, { "anthropic-beta": "some-beta" });
  assert.equal(replayed.status, 200);
  assert.equal(replayed.headers.get("content-type"), "application/json");
  assert.equal(await textOf(replayed), "SYN-45 is in SYN-3.");
  assert.equal(live.seen.length, 1);
});

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

test("recordings land only on commit, replacing the case's old cassettes", async (t) => {
  const dir = tempDir(t);
  await recordOne(dir, network().fetch);
  const [first] = files(dir);
  const later = { ...body, messages: [{ role: "user", content: "And SYN-46?" }] };

  // A case that errors partway never commits: its last good recording stays.
  const abandoned = cassettes({ mode: "record", dir, live: network().fetch });
  await abandoned.fetch(messagesUrl, post(later));
  assert.deepEqual(files(dir), [first]);
  assert.equal(await textOf(await replayOne(dir)), "SYN-45 is in SYN-3.");

  // A case that finishes holds exactly what it asked this time.
  const finished = cassettes({ mode: "record", dir, live: network().fetch });
  await finished.fetch(messagesUrl, post(later));
  finished.commit();
  assert.equal(files(dir).length, 1);
  assert.notEqual(files(dir)[0], first);
  assert.equal((await replayOne(dir, later)).status, 200);
  await assert.rejects(replayOne(dir), /no cassette/);
});

test("replay fails clearly when a cassette is missing", async (t) => {
  const dir = tempDir(t);
  await assert.rejects(
    replayOne(dir),
    /^Error: no cassette for this claude-opus-5-5 request: .*\/[0-9a-f]{64}\.json is missing\. The request changed or was never recorded; record it with `pnpm evals`\.$/,
  );
});

test("a cassette whose request doesn't match its name is refused", async (t) => {
  const dir = tempDir(t);
  await recordOne(dir, network().fetch);
  const file = new URL(files(dir)[0] ?? "", dir);
  writeFileSync(file, readFileSync(file, "utf8").replace("Which epic", "Which story"));
  await assert.rejects(replayOne(dir), /holds a different request than its name says/);
});

test("a failed response passes through, and its case's set is not committed", async (t) => {
  const dir = tempDir(t);
  await recordOne(dir, network().fetch);
  const before = files(dir);

  // A retry after a rate limit succeeds, but the case wouldn't replay as run.
  let calls = 0;
  const flaky = network(() =>
    calls++ ? message("SYN-45 is in SYN-3.") : new Response("rate limited", { status: 429 }),
  );
  const tape = cassettes({ mode: "record", dir, live: flaky.fetch });
  const later = { ...body, messages: [{ role: "user", content: "And SYN-46?" }] };
  const response = await tape.fetch(messagesUrl, post(later));
  assert.equal(response.status, 429);
  assert.equal(await response.text(), "rate limited");
  assert.equal((await tape.fetch(messagesUrl, post(later))).status, 200);
  assert.equal(
    tape.commit(),
    "not recorded: 1 response(s) failed (HTTP 429), so this case wouldn't replay; its earlier cassettes stay",
  );
  assert.deepEqual(files(dir), before);
});

test("each pair of model and judge keeps its own cassettes", () => {
  const root = new URL("file:///repo/tests/cassettes/");
  assert.equal(
    cassetteDir(root, "injection-weather", "claude-opus-5-5", "claude-sonnet-5-5").href,
    "file:///repo/tests/cassettes/injection-weather/claude-opus-5-5+claude-sonnet-5-5/",
  );
  // Names are made safe as single path segments.
  assert.equal(
    cassetteDir(root, "a-case", "../../etc", "us.anthropic/claude:x").href,
    "file:///repo/tests/cassettes/a-case/.._.._etc+us.anthropic_claude_x/",
  );
  assert.equal(
    cassetteDir(root, "a-case", "..", ".").href,
    "file:///repo/tests/cassettes/a-case/_+_/",
  );
});

test("a streamed response is stored as text and replays as an event stream", async (t) => {
  const dir = tempDir(t);
  const events =
    'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-opus-5-5"}}\n\n' +
    'event: message_stop\ndata: {"type":"message_stop"}\n\n';
  const live = network(
    () => new Response(events, { headers: { "content-type": "text/event-stream" } }),
  );
  const streamed = { ...body, stream: true };
  await recordOne(dir, live.fetch, streamed);
  const replayed = await replayOne(dir, streamed);
  assert.equal(replayed.headers.get("content-type"), "text/event-stream");
  const text = await replayed.text();
  assert.equal(text, events);
  assert.equal(responseModel(text), "claude-opus-5-5");
});

test("only Messages API requests get through, recorded or live", async (t) => {
  const dir = tempDir(t);
  const { fetch } = cassettes({ mode: "record", dir, live: network().fetch });
  await assert.rejects(fetch("https://api.anthropic.com/v1/models"), /hold only POST/);
  await assert.rejects(fetch("https://example.com/v1/messages", post(body)), /hold only POST/);
  await assert.rejects(fetch(messagesUrl, { method: "POST", body: "not json" }), /must be JSON/);
  const live = anthropicFetch("sk-ant-api03-LIVEKEY", network().fetch);
  await assert.rejects(live("https://example.com/v1/messages", post(body)), /reach only POST/);
});

test("a committed cassette still replays: the key is stable", async () => {
  const dir = new URL("../../../tests/cassettes/_unit/", import.meta.url);
  assert.equal(await textOf(await replayOne(dir)), "SYN-45 is in SYN-3.");
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

test("an alias and its dated snapshots are one model", () => {
  assert.equal(sameModel("claude-sonnet-5-5", "claude-sonnet-5-5-20261001"), true);
  assert.equal(sameModel("claude-sonnet-5-5-latest", "claude-sonnet-5-5"), true);
  assert.equal(sameModel("claude-sonnet-5-5", "claude-sonnet-5"), false);
  assert.equal(sameModel("claude-opus-5-5", "claude-sonnet-5-5"), false);
});
