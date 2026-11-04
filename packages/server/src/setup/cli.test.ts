// What the first run fetches before it runs anything: Anthropic's installer,
// over HTTPS, from claude.ai's own hosts only, redirects included, and no
// bigger than an installer is. The fetch is a stand-in; nothing reaches the
// network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { accountOf, fetchText, installerUrl } from "./cli.ts";

// Answers each URL from a table: a body, or a redirect to another URL.
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

test("the installer is fetched from claude.ai over HTTPS, following its own redirect", async () => {
  const { send, asked } = site({
    [installerUrl]: { location: "https://downloads.claude.ai/claude-code-releases/bootstrap.sh" },
    "https://downloads.claude.ai/claude-code-releases/bootstrap.sh": { body: "#!/bin/bash\n" },
  });
  assert.equal(await fetchText(installerUrl, send), "#!/bin/bash\n");
  assert.deepEqual(asked, [
    installerUrl,
    "https://downloads.claude.ai/claude-code-releases/bootstrap.sh",
  ]);
});

test("a redirect off claude.ai, or to plain HTTP, is refused before it's followed", async () => {
  for (const location of [
    "https://evil.example/install.sh",
    "http://downloads.claude.ai/install.sh",
    "https://evilclaude.ai/install.sh",
    "https://claude.ai.evil.example/install.sh",
  ]) {
    const { send, asked } = site({ [installerUrl]: { location } });
    await assert.rejects(fetchText(installerUrl, send), /only HTTPS on claude\.ai/);
    assert.deepEqual(asked, [installerUrl]);
  }
});

test("an answer that isn't an installer is refused: an error, or too much", async () => {
  const failing = site({ [installerUrl]: { status: 503, body: "busy" } });
  await assert.rejects(fetchText(installerUrl, failing.send), /answered 503/);
  const huge = site({ [installerUrl]: { body: "x".repeat(1024 * 1024 + 1) } });
  await assert.rejects(fetchText(installerUrl, huge.send), /more than an installer/);
  const looping = site({ [installerUrl]: { location: installerUrl } });
  await assert.rejects(fetchText(installerUrl, looping.send), /too many redirects/);
});

test("the plan and email come from the CLI's own status, only once it's signed in", () => {
  assert.deepEqual(
    accountOf('{"loggedIn":true,"email":"maya@example.com","subscriptionType":"max"}'),
    { plan: "Claude Max", email: "maya@example.com", personal: true },
  );
  assert.deepEqual(accountOf('{"loggedIn":true,"authMethod":"oauth_token"}'), {
    plan: null,
    email: null,
    personal: true,
  });
  assert.equal(accountOf('{"loggedIn":false}'), null);
  assert.equal(accountOf("not json"), null);
  // Team and Enterprise plans, and an API key, aren't trained on.
  for (const plan of ["team", "enterprise"])
    assert.equal(accountOf(`{"loggedIn":true,"subscriptionType":"${plan}"}`)?.personal, false);
  assert.equal(accountOf('{"loggedIn":true,"subscriptionType":"pro"}')?.personal, true);
  assert.equal(accountOf('{"loggedIn":true,"authMethod":"api_key"}')?.personal, false);
  // A plan name the page shows only as the CLI's own short word.
  assert.equal(accountOf('{"loggedIn":true,"subscriptionType":"<b>x</b>"}')?.plan, null);
});
