import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { pathToFileURL } from "node:url";

export function tempDir(t: TestContext): URL {
  const path = mkdtempSync(join(tmpdir(), "oriel-evals-"));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return pathToFileURL(`${path}/`);
}

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
