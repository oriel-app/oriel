// One turn of the agent's Anthropic provider, two requests long, recorded as
// cassettes from hand-written streams rather than the live API. CI replays
// them in provider-cassette.test.ts: a request whose shape changed has no
// cassette, so the replay pins what the provider sends as well as how it reads
// what comes back. After a deliberate change to the request, re-record with
// `node packages/evals/src/provider-cassette.ts` and commit the cassettes.
import { anthropicProvider, type ModelEvent, type ToolSpec } from "@oriel/agent";
import type { Fetch } from "./anthropic.ts";
import { cassettes } from "./cassette.ts";

export const providerCassettes = new URL("../../../tests/cassettes/_provider/", import.meta.url);

// Not the agent's own prompt or tool: this pins the provider's shapes, and
// prompt changes shouldn't need a re-recording.
const system = "You answer questions about a region's items with the run tool.";
const tool: ToolSpec = {
  name: "run",
  description: 'Run a script.\n\n```ts\ntype RegionId =\n  | "jira:ABC-1"\n  | "jira:ABC-2";\n```',
  inputSchema: {
    type: "object",
    properties: { script: { type: "string" } },
    required: ["script"],
    additionalProperties: false,
  },
};

const sse = (events: object[]) =>
  events
    .map(
      (event) => `event: ${String(Reflect.get(event, "type"))}\ndata: ${JSON.stringify(event)}\n\n`,
    )
    .join("");

const start = (usage: object) => ({
  type: "message_start",
  message: {
    id: "msg_provider",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [],
    stop_reason: null,
    usage,
  },
});

// What the API would stream: first a thinking block, a line of text and a
// run, then, once the run's result is back, the answer.
export const streams = [
  sse([
    start({
      input_tokens: 31,
      cache_creation_input_tokens: 1204,
      cache_read_input_tokens: 0,
      output_tokens: 2,
    }),
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "thinking", thinking: "", signature: "" },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "signature_delta", signature: "EuYBCkQYAiJA-handwritten-signature" },
    },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Let me " } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "check." } },
    { type: "content_block_stop", index: 1 },
    {
      type: "content_block_start",
      index: 2,
      content_block: { type: "tool_use", id: "toolu_01Provider", name: "run", input: {} },
    },
    {
      type: "content_block_delta",
      index: 2,
      delta: { type: "input_json_delta", partial_json: '{"script": "const s = await ' },
    },
    {
      type: "content_block_delta",
      index: 2,
      delta: { type: "input_json_delta", partial_json: 'jira.listStories();\\nreturn s.length;"}' },
    },
    { type: "content_block_stop", index: 2 },
    {
      type: "message_delta",
      delta: { stop_reason: "tool_use", stop_sequence: null },
      usage: { output_tokens: 96 },
    },
    { type: "message_stop" },
  ]),
  sse([
    start({
      input_tokens: 40,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 1204,
      output_tokens: 1,
    }),
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Two stories." } },
    { type: "content_block_stop", index: 0 },
    { type: "ping" },
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 12 },
    },
    { type: "message_stop" },
  ]),
];

async function collect(responses: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const events: ModelEvent[] = [];
  for await (const event of responses) events.push(event);
  return events;
}

// The turn: a question, the run the model asks for, its result, the answer.
export async function providerTurn(fetch: Fetch): Promise<ModelEvent[][]> {
  const conversation = anthropicProvider({ apiKey: "not-a-key", fetch }).converse({
    system,
    tools: [tool],
    messages: [{ role: "user", text: "How many stories are there?" }],
    signal: new AbortController().signal,
    log: () => {},
  });
  // Room for the provider's whole default output, so `max_tokens` is 64000.
  const room = { maxOutputTokens: 64_000 };
  const first = await collect(conversation.next([], room));
  const callIds = first.flatMap((event) => (event.kind === "call" ? [event.call.id] : []));
  const second = await collect(
    conversation.next(
      callIds.map((callId) => ({ callId, content: "Returned: 2", isError: false })),
      room,
    ),
  );
  return [first, second];
}

if (import.meta.main) {
  const answers = [...streams];
  const live: Fetch = async () =>
    new Response(answers.shift(), { headers: { "content-type": "text/event-stream" } });
  const tape = cassettes({ mode: "record", dir: providerCassettes, live });
  await providerTurn(tape.fetch);
  const unsaved = tape.commit();
  if (unsaved) throw new Error(unsaved);
}
