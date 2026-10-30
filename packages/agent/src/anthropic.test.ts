// The Messages API provider against hand-written streams: what it sends, how
// it reads a response, and that the key goes nowhere but its header.
import assert from "node:assert/strict";
import { test } from "node:test";
import { inspect } from "node:util";
import { anthropicProvider, apiVersion, fallbackBeta, messagesUrl } from "./anthropic.ts";
import { runTool, systemPrompt, threadMessages } from "./prompt.ts";
import {
  type ConversationRequest,
  type ModelEvent,
  type Provider,
  ProviderError,
} from "./provider.ts";
import { t0 } from "./testing.ts";

const key = "sk-ant-api03-TESTKEY-never-print";

// Server-sent events as the API writes them, split into small chunks so a
// line or an event can fall across two reads.
function stream(events: object[], options: { signal?: AbortSignal; open?: boolean } = {}) {
  const bytes = new TextEncoder().encode(
    events
      .map((e) => `event: ${String(Reflect.get(e, "type"))}\ndata: ${JSON.stringify(e)}\n\n`)
      .join(""),
  );
  let at = 0;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      options.signal?.addEventListener("abort", () => controller.error(options.signal?.reason));
    },
    pull(controller) {
      if (at < bytes.length) {
        controller.enqueue(bytes.slice(at, at + 7));
        at += 7;
        return undefined;
      }
      // An open stream waits, as a slow model does, until it is aborted.
      if (options.open) return new Promise<void>(() => {});
      controller.close();
      return undefined;
    },
  });
}

type Seen = { url: string; headers: Headers; body: Record<string, unknown> };

// A stand-in for the network: answers each request with the next response
// and keeps what it was sent.
function api(answers: ((signal: AbortSignal) => Response)[]) {
  const seen: Seen[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    seen.push({
      url: request.url,
      headers: request.headers,
      body: JSON.parse(await request.text()) as Record<string, unknown>,
    });
    const answer = answers.shift();
    if (!answer) throw new Error("no more answers");
    return answer(init?.signal ?? new AbortController().signal);
  };
  return { fetch, seen };
}

const messagesOf = (seen: Seen | undefined): unknown[] => {
  const messages = seen?.body["messages"];
  if (!Array.isArray(messages)) throw new Error("no messages were sent");
  return messages;
};

const events = (events: object[]) => (signal: AbortSignal) =>
  new Response(stream(events, { signal }), { headers: { "content-type": "text/event-stream" } });

const start = (
  model = "claude-opus-5-5",
  usage: object = { input_tokens: 40, output_tokens: 1 },
) => ({
  type: "message_start",
  message: { id: "msg_1", type: "message", role: "assistant", model, content: [], usage },
});

const textBlock = (index: number, ...parts: string[]) => [
  { type: "content_block_start", index, content_block: { type: "text", text: "" } },
  ...parts.map((text) => ({
    type: "content_block_delta",
    index,
    delta: { type: "text_delta", text },
  })),
  { type: "content_block_stop", index },
];

const toolBlock = (index: number, id: string, ...json: string[]) => [
  {
    type: "content_block_start",
    index,
    content_block: { type: "tool_use", id, name: "run", input: {} },
  },
  ...json.map((partial_json) => ({
    type: "content_block_delta",
    index,
    delta: { type: "input_json_delta", partial_json },
  })),
  { type: "content_block_stop", index },
];

const thinkingBlock = (index: number, signature: string) => [
  {
    type: "content_block_start",
    index,
    content_block: { type: "thinking", thinking: "", signature: "" },
  },
  { type: "content_block_delta", index, delta: { type: "signature_delta", signature } },
  { type: "content_block_stop", index },
];

const end = (stop_reason: string, usage: object = { output_tokens: 30 }, extra: object = {}) => [
  { type: "message_delta", delta: { stop_reason, stop_sequence: null, ...extra }, usage },
  { type: "message_stop" },
];

type Logged = { message: string; fields: unknown };

function conversation(
  provider: Provider,
  overrides: Partial<ConversationRequest> = {},
  logged: Logged[] = [],
) {
  return provider.converse({
    system: systemPrompt,
    tools: [runTool('type RegionId =\n  | "jira:ABC-1";\n')],
    messages: [{ role: "user", text: "Which stories have no estimate?" }],
    signal: new AbortController().signal,
    log: (message, fields) => logged.push({ message, fields }),
    ...overrides,
  });
}

async function collect(responses: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const out: ModelEvent[] = [];
  for await (const event of responses) out.push(event);
  return out;
}

test("a request streams from the default model, with caching on the system prompt, the tool and the tail", async () => {
  const network = api([events([start(), ...textBlock(0, "Hi."), ...end("end_turn")])]);
  await collect(conversation(anthropicProvider({ apiKey: key, fetch: network.fetch })).next([]));

  const [sent] = network.seen;
  assert.equal(sent?.url, messagesUrl);
  assert.equal(sent?.headers.get("x-api-key"), key);
  assert.equal(sent?.headers.get("anthropic-version"), apiVersion);
  assert.equal(sent?.headers.get("anthropic-beta"), null);
  const tool = runTool('type RegionId =\n  | "jira:ABC-1";\n');
  assert.deepEqual(sent?.body, {
    model: "claude-opus-5-5",
    max_tokens: 64_000,
    stream: true,
    system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
    tools: [
      {
        name: "run",
        description: tool.description,
        input_schema: tool.inputSchema,
        strict: true,
        cache_control: { type: "ephemeral" },
      },
    ],
    tool_choice: { type: "auto", disable_parallel_tool_use: true },
    output_config: { effort: "medium" },
    cache_control: { type: "ephemeral" },
    messages: [
      { role: "user", content: [{ type: "text", text: "Which stories have no estimate?" }] },
    ],
  });
});

test("options set the model, the output cap and the effort, and can turn fallbacks on", async () => {
  const network = api([events([start("claude-sonnet-5-5"), ...end("end_turn")])]);
  const provider = anthropicProvider({
    apiKey: key,
    model: "claude-sonnet-5-5",
    maxTokens: 8_000,
    effort: "low",
    fallbacks: true,
    fetch: network.fetch,
  });
  await collect(conversation(provider).next([]));

  const [sent] = network.seen;
  assert.equal(sent?.headers.get("anthropic-beta"), fallbackBeta);
  assert.equal(sent?.body["model"], "claude-sonnet-5-5");
  assert.equal(sent?.body["max_tokens"], 8_000);
  assert.deepEqual(sent?.body["output_config"], { effort: "low" });
  assert.equal(sent?.body["fallbacks"], "default");
});

test("a response streams its text, then its call, then why it stopped and what it used", async () => {
  const network = api([
    events([
      start("claude-opus-5-5", {
        input_tokens: 40,
        cache_creation_input_tokens: 900,
        cache_read_input_tokens: 0,
        output_tokens: 1,
      }),
      ...thinkingBlock(0, "sig-abc"),
      ...textBlock(1, "Let me ", "look."),
      ...toolBlock(2, "toolu_1", '{"scr', 'ipt": "return 1;"}'),
      ...end("tool_use", { output_tokens: 75 }),
    ]),
  ]);
  const got = await collect(
    conversation(anthropicProvider({ apiKey: key, fetch: network.fetch })).next([]),
  );

  assert.deepEqual(got, [
    { kind: "text", text: "Let me " },
    { kind: "text", text: "look." },
    { kind: "call", call: { id: "toolu_1", name: "run", input: { script: "return 1;" } } },
    {
      kind: "end",
      stop: "calls",
      detail: "tool_use",
      model: "claude-opus-5-5",
      usage: { inputTokens: 940, outputTokens: 75, cacheReadTokens: 0, cacheWriteTokens: 900 },
    },
  ]);
});

test("the next request sends the response back unchanged, thinking and signature included, then the results", async () => {
  const network = api([
    events([
      start(),
      ...thinkingBlock(0, "sig-abc"),
      ...toolBlock(1, "toolu_1", '{"script": "return 1;"}'),
      ...end("tool_use"),
    ]),
    events([start(), ...textBlock(0, "One."), ...end("end_turn")]),
  ]);
  const turn = conversation(anthropicProvider({ apiKey: key, fetch: network.fetch }));
  await collect(turn.next([]));
  await collect(
    turn.next([{ callId: "toolu_1", content: "Failed at runtime: no", isError: true }]),
  );

  const [first, second] = network.seen;
  const messages = second?.body["messages"];
  assert.deepEqual(messages, [
    ...messagesOf(first),
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "", signature: "sig-abc" },
        { type: "tool_use", id: "toolu_1", name: "run", input: { script: "return 1;" } },
      ],
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_1",
          content: "Failed at runtime: no",
          is_error: true,
        },
      ],
    },
  ]);
  // Everything before the messages is the same bytes, so the cache holds.
  const rest = (body: Record<string, unknown> = {}) =>
    Object.fromEntries(Object.entries(body).filter(([name]) => name !== "messages"));
  assert.deepEqual(rest(second?.body), rest(first?.body));
});

test("the thread's history goes as text, and its runs and markers as tool results", async () => {
  const network = api([events([start(), ...end("end_turn")])]);
  const messages = threadMessages(
    [
      { role: "user", text: "What does ABC-1 say?", at: t0 },
      { role: "assistant", text: "Let me look.", at: t0 },
      { role: "run", runId: "01RUN" as never, summary: 'Returned: "Fares"', at: t0 },
      { role: "assistant", text: "It is about fares.", at: t0 },
    ],
    "And now?",
  );
  await collect(
    conversation(anthropicProvider({ apiKey: key, fetch: network.fetch }), { messages }).next([]),
  );

  assert.deepEqual(network.seen[0]?.body["messages"], [
    { role: "user", content: [{ type: "text", text: "What does ABC-1 say?" }] },
    {
      role: "assistant",
      content: [
        { type: "text", text: "Let me look." },
        {
          type: "tool_use",
          id: "history_2",
          name: "run",
          input: {
            script:
              "// Run 01RUN, earlier in this thread. Its script isn't kept; the result is its summary.",
          },
        },
      ],
    },
    {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "history_2", content: 'Returned: "Fares"' }],
    },
    { role: "assistant", content: [{ type: "text", text: "It is about fares." }] },
    { role: "user", content: [{ type: "text", text: "And now?" }] },
  ]);
});

test("after a fallback, text from before it goes back and its calls don't run", async () => {
  const network = api([
    events([
      start(),
      ...thinkingBlock(0, "sig-declined"),
      ...textBlock(1, "Checking the "),
      ...toolBlock(2, "toolu_declined", '{"script": "return 0;"}'),
      {
        type: "content_block_start",
        index: 3,
        content_block: {
          type: "fallback",
          from: { model: "claude-opus-5-5" },
          to: { model: "claude-opus-5" },
        },
      },
      { type: "content_block_stop", index: 3 },
      ...textBlock(4, "stories."),
      ...toolBlock(5, "toolu_kept", '{"script": "return 1;"}'),
      ...end("tool_use"),
    ]),
    events([start("claude-opus-5"), ...end("end_turn")]),
  ]);
  const turn = conversation(anthropicProvider({ apiKey: key, fetch: network.fetch }));
  const got = await collect(turn.next([]));
  await collect(turn.next([{ callId: "toolu_kept", content: "Returned: 1", isError: false }]));

  assert.deepEqual(
    got.filter((e) => e.kind !== "end"),
    [
      { kind: "text", text: "Checking the " },
      { kind: "text", text: "stories." },
      { kind: "call", call: { id: "toolu_kept", name: "run", input: { script: "return 1;" } } },
    ],
  );
  const last = got.at(-1);
  assert.equal(last?.kind === "end" && last.model, "claude-opus-5");
  const echoed = messagesOf(network.seen[1]).at(-2);
  assert.deepEqual(echoed, {
    role: "assistant",
    content: [
      { type: "text", text: "Checking the " },
      { type: "text", text: "stories." },
      { type: "tool_use", id: "toolu_kept", name: "run", input: { script: "return 1;" } },
    ],
  });
});

test("a refusal stops with its category, and a cut-off reply with max-tokens", async () => {
  const network = api([
    events([
      start(),
      ...end(
        "refusal",
        { output_tokens: 0 },
        { stop_details: { type: "refusal", category: "cyber" } },
      ),
    ]),
    events([start(), ...textBlock(0, "The sto"), ...end("max_tokens")]),
  ]);
  const provider = anthropicProvider({ apiKey: key, fetch: network.fetch });
  const refused = await collect(conversation(provider).next([]));
  const cut = await collect(conversation(provider).next([]));

  assert.deepEqual(
    [refused.at(-1), cut.at(-1)].map((e) => e?.kind === "end" && [e.stop, e.detail]),
    [
      ["refused", "cyber"],
      ["max-tokens", "max_tokens"],
    ],
  );
});

test("a call whose input isn't JSON comes through as its raw text, and goes back as an empty object", async () => {
  const network = api([
    events([start(), ...toolBlock(0, "toolu_1", '{"script": "ret'), ...end("tool_use")]),
    events([start(), ...end("end_turn")]),
  ]);
  const turn = conversation(anthropicProvider({ apiKey: key, fetch: network.fetch }));
  const got = await collect(turn.next([]));
  await collect(turn.next([{ callId: "toolu_1", content: "bad input", isError: true }]));

  assert.deepEqual(got[0], {
    kind: "call",
    call: { id: "toolu_1", name: "run", input: '{"script": "ret' },
  });
  const echoed = messagesOf(network.seen[1]).at(-2);
  assert.deepEqual(echoed, {
    role: "assistant",
    content: [{ type: "tool_use", id: "toolu_1", name: "run", input: {} }],
  });
});

test("an error event, a stream that ends early, and a bad event are provider errors", async () => {
  const network = api([
    events([
      start(),
      ...textBlock(0, "Hi"),
      { type: "error", error: { type: "overloaded_error", message: "Overloaded" } },
    ]),
    events([start(), ...textBlock(0, "Hi")]),
    () => new Response("data: {not json\n\n", { headers: { "content-type": "text/event-stream" } }),
  ]);
  const provider = anthropicProvider({ apiKey: key, fetch: network.fetch });
  await assert.rejects(collect(conversation(provider).next([])), {
    name: "ProviderError",
    message: "The model provider stopped its response: Overloaded.",
  });
  await assert.rejects(collect(conversation(provider).next([])), {
    message: "The model provider's response ended early.",
  });
  await assert.rejects(collect(conversation(provider).next([])), {
    message: "The model provider sent a response Oriel can't read: an event isn't JSON.",
  });
});

test("the key goes nowhere but its header: not in errors, logs or the provider", async () => {
  const logged: Logged[] = [];
  const network = api([
    () =>
      new Response(
        JSON.stringify({
          type: "error",
          error: { type: "authentication_error", message: `invalid x-api-key ${key}` },
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      ),
  ]);
  const provider = anthropicProvider({ apiKey: key, fetch: network.fetch });
  const refused = await collect(conversation(provider, {}, logged).next([])).catch(
    (error: unknown) => error,
  );
  assert.ok(refused instanceof ProviderError);
  assert.equal(refused.status, 401);
  assert.equal(
    refused.message,
    "The model provider refused the request (HTTP 401): invalid x-api-key [key]",
  );

  const offline = anthropicProvider({
    apiKey: key,
    fetch: async () => {
      throw new TypeError(`fetch failed for ${key}`);
    },
  });
  await assert.rejects(collect(conversation(offline, {}, logged).next([])), {
    message: "Oriel couldn't reach the model provider: fetch failed for [key]",
  });

  assert.ok(logged.length > 0);
  assert.doesNotMatch(JSON.stringify(logged), /TESTKEY/);
  assert.doesNotMatch(inspect(provider, { depth: 10, showHidden: true }), /TESTKEY/);
  assert.doesNotMatch(JSON.stringify(provider), /TESTKEY/);
});

test("an abort mid-stream rejects with the signal's reason", async () => {
  const controller = new AbortController();
  const reason = new Error("the user stopped it");
  const network = api([
    (signal) =>
      new Response(stream([start(), ...textBlock(0, "Hi")], { signal, open: true }), {
        headers: { "content-type": "text/event-stream" },
      }),
  ]);
  const provider = anthropicProvider({ apiKey: key, fetch: network.fetch });
  const got: ModelEvent[] = [];
  const reading = (async () => {
    for await (const event of conversation(provider, { signal: controller.signal }).next([])) {
      got.push(event);
      controller.abort(reason);
    }
  })();
  await assert.rejects(reading, reason);
  assert.deepEqual(got, [{ kind: "text", text: "Hi" }]);
});
