import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchText, installerUrl } from "./cli.ts";

function site(table: Record<string, { body?: string; location?: string; status?: number }>) {
  const asked: string[] = [];
  const send = (async (input: URL | Request | string, init?: RequestInit) => {
    const url = String(input);
    asked.push(url);
    assert.equal(init?.redirect, "manual");
    const answer = table[url];
    if (!answer) return new Response("", { status: 404 });
    if (answer.location)
      return new Response("", { status: 302, headers: { location: answer.location } });
    return new Response(answer.body ?? "", { status: answer.status ?? 200 });
  }) as typeof fetch;
  return { send, asked };
}

test("a redirect off claude.ai, or to plain HTTP, is refused before it's followed", async () => {
  for (const location of [
    "https://evil.example/install.sh",
    "http://downloads.claude.ai/install.sh",
    "https://evilclaude.ai/install.sh",
    "https://claude.ai.evil.example/install.sh",
  ]) {
    const { send, asked } = site({ [installerUrl]: { location } });
    await assert.rejects(fetchText(installerUrl, send));
    assert.deepEqual(asked, [installerUrl]);
  }
});

test("an answer too big for an installer, or a redirect loop, is refused", async () => {
  const huge = site({ [installerUrl]: { body: "x".repeat(1024 * 1024 + 1) } });
  await assert.rejects(fetchText(installerUrl, huge.send));
  const looping = site({ [installerUrl]: { location: installerUrl } });
  await assert.rejects(fetchText(installerUrl, looping.send));
});
