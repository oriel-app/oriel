// Shared by this package's tests only.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { pathToFileURL } from "node:url";
import { type Fetch, messagesResponse } from "./anthropic.ts";
import type { Cassettes } from "./cassette.ts";

// A fresh directory, removed when the test ends.
export function tempDir(t: TestContext): URL {
  const path = mkdtempSync(join(tmpdir(), "oriel-evals-"));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return pathToFileURL(`${path}/`);
}

// A Messages API response holding one text block, from the judge's model
// unless another is named.
export function message(
  text: string,
  { model = "claude-sonnet-5-5", stop = "end_turn" }: { model?: string; stop?: string } = {},
): Response {
  return Response.json({
    id: "msg_test",
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text }],
    stop_reason: stop,
    usage: { input_tokens: 1, output_tokens: 1 },
  });
}

// Cassettes that never record: a plain fetch, for tests that don't replay.
export const uncommitted = (fetch: Fetch): Cassettes => ({ fetch, commit: () => null });

// The text of a Messages API response.
export async function textOf(response: Response): Promise<string> {
  const parsed = messagesResponse(await response.json());
  assert.ok(parsed.ok, "not a Messages API response");
  return parsed.value.content.map((block) => block.text ?? "").join("");
}

export const verdicts = (...holds: boolean[]) =>
  JSON.stringify({
    verdicts: holds.map((h, i) => ({
      claim: i + 1,
      reason: h ? "it does" : "it doesn't",
      holds: h,
    })),
  });

// A streamed Messages API response, as the API would send it: some text,
// then a call to the agent's run tool when `script` is given.
export function streamed(
  { text, script }: { text: string; script?: string },
  model = "claude-opus-5-5",
): Response {
  const usage = { input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const events: object[] = [
    {
      type: "message_start",
      message: { id: "msg_test", type: "message", role: "assistant", model, content: [], usage },
    },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
  ];
  if (script !== undefined)
    events.push(
      {
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "toolu_test", name: "run", input: {} },
      },
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: JSON.stringify({ script }) },
      },
      { type: "content_block_stop", index: 1 },
    );
  events.push(
    {
      type: "message_delta",
      delta: { stop_reason: script === undefined ? "end_turn" : "tool_use" },
      usage: { output_tokens: 20 },
    },
    { type: "message_stop" },
  );
  const body = events
    .map((e) => `event: ${String(Reflect.get(e, "type"))}\ndata: ${JSON.stringify(e)}\n\n`)
    .join("");
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

// Answers each request with the next response, and keeps each request's body.
export function scriptedModel(responses: Response[]) {
  const queue = [...responses];
  const bodies: Record<string, unknown>[] = [];
  const fetch: Fetch = async (input, init) => {
    bodies.push((await new Request(input, init).json()) as Record<string, unknown>);
    const next = queue.shift();
    if (!next) throw new Error("the scripted model has no more responses");
    return next;
  };
  return { fetch, bodies };
}
