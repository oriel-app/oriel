import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { cassettes } from "./cassette.ts";
import { providerCassettes, providerTurn, streams } from "./provider-cassette.ts";

type Stored = { request: { body: Record<string, unknown> }; response: { body: unknown } };

// The committed cassettes, each found by the stream it answers with.
function stored(): Stored[] {
  const all = readdirSync(providerCassettes)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(new URL(name, providerCassettes), "utf8")) as Stored);
  assert.equal(all.length, streams.length);
  return streams.map((stream) => {
    const found = all.find((cassette) => cassette.response.body === stream);
    if (!found) throw new Error("a hand-written stream has no cassette");
    return found;
  });
}

const messagesOf = (cassette: Stored | undefined): unknown[] => {
  const messages = cassette?.request.body["messages"];
  if (!Array.isArray(messages)) throw new Error("the request sent no messages");
  return messages;
};

test("the agent's provider replays a turn from its cassettes, offline", async () => {
  const [first, second] = await providerTurn(
    cassettes({ mode: "replay", dir: providerCassettes }).fetch,
  );
  const firstUsage = {
    inputTokens: 1235,
    outputTokens: 96,
    cacheReadTokens: 0,
    cacheWriteTokens: 1204,
  };
  assert.deepEqual(first, [
    { kind: "usage", usage: { ...firstUsage, outputTokens: 2 } },
    { kind: "text", text: "Let me " },
    { kind: "text", text: "check." },
    { kind: "usage", usage: firstUsage },
    {
      kind: "call",
      call: {
        id: "toolu_01Provider",
        name: "run",
        input: { script: "const s = await jira.listStories();\nreturn s.length;" },
      },
    },
    { kind: "end", stop: "calls", detail: "tool_use", model: "claude-opus-5-5", usage: firstUsage },
  ]);
  const secondUsage = {
    inputTokens: 1244,
    outputTokens: 12,
    cacheReadTokens: 1204,
    cacheWriteTokens: 0,
  };
  assert.deepEqual(second, [
    { kind: "usage", usage: { ...secondUsage, outputTokens: 1 } },
    { kind: "text", text: "Two stories." },
    { kind: "usage", usage: secondUsage },
    { kind: "end", stop: "done", detail: "end_turn", model: "claude-opus-5-5", usage: secondUsage },
  ]);
});

test("the cassettes hold the hand-written streams, and the second request sends the first reply back whole", () => {
  const [first, second] = stored();
  for (const cassette of [first, second]) {
    assert.equal(cassette?.request.body["model"], "claude-opus-5-5");
    assert.equal(cassette?.request.body["stream"], true);
  }
  assert.deepEqual(messagesOf(second).slice(1), [
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "", signature: "EuYBCkQYAiJA-handwritten-signature" },
        { type: "text", text: "Let me check." },
        {
          type: "tool_use",
          id: "toolu_01Provider",
          name: "run",
          input: { script: "const s = await jira.listStories();\nreturn s.length;" },
        },
      ],
    },
    {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_01Provider", content: "Returned: 2" }],
    },
  ]);
});
