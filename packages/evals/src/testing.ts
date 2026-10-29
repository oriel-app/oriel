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
export const uncommitted = (fetch: Fetch): Cassettes => ({ fetch, commit: () => {} });

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
