// Shared by this package's tests only.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { pathToFileURL } from "node:url";
import { messagesResponse } from "./anthropic.ts";

// A fresh directory, removed when the test ends.
export function tempDir(t: TestContext): URL {
  const path = mkdtempSync(join(tmpdir(), "oriel-evals-"));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return pathToFileURL(`${path}/`);
}

// A Messages API response holding one text block.
export function message(text: string, stop = "end_turn"): Response {
  return Response.json({
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content: [{ type: "text", text }],
    stop_reason: stop,
    usage: { input_tokens: 1, output_tokens: 1 },
  });
}

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
