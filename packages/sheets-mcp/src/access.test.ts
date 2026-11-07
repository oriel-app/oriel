import assert from "node:assert/strict";
import { test } from "node:test";
import { googleAccess, notSignedIn } from "./access.ts";
import { type Fetch, tokenEndpoint } from "./oauth.ts";
import type { TokenFile } from "./token-file.ts";

// Made-up values; none is a real client or token.
const client = { id: "123456789012-fakeclient.apps.googleusercontent.com", secret: null };

function memoryFile(refresh: string | null): TokenFile & { writes: string[] } {
  let kept = refresh;
  const writes: string[] = [];
  return {
    path: "/nowhere/token.json",
    read: () => kept,
    write: (token) => {
      kept = token;
      writes.push(token);
    },
    remove: () => kept !== null && ((kept = null), true),
    writes,
  };
}

// Google's token endpoint, answering each refresh with the next reply.
function endpoint(...replies: { status: number; body: unknown }[]) {
  const forms: URLSearchParams[] = [];
  const fetch: Fetch = async (input, init) => {
    assert.equal(String(input), tokenEndpoint);
    forms.push(new URLSearchParams(String(init?.body)));
    const reply = replies.shift();
    assert.ok(reply, "no more replies");
    return Response.json(reply.body, { status: reply.status });
  };
  return { fetch, forms };
}

const granted = (access: string, refresh?: string) => ({
  status: 200,
  body: { access_token: access, expires_in: 3600, ...(refresh ? { refresh_token: refresh } : {}) },
});

test("the kept refresh token buys an access token, held until a minute before it expires", async () => {
  let now = 1_000_000;
  const google = endpoint(granted("access-1"), granted("access-2"));
  const source = googleAccess({
    client: () => client,
    file: memoryFile("refresh-1"),
    fetch: google.fetch,
    now: () => now,
  });
  assert.deepEqual(await source.access(), { status: "ok", token: "access-1" });
  assert.deepEqual(Object.fromEntries(google.forms[0] ?? []), {
    grant_type: "refresh_token",
    refresh_token: "refresh-1",
    client_id: client.id,
  });
  now += 3_539_000;
  assert.deepEqual(await source.access(), { status: "ok", token: "access-1" });
  now += 1_000;
  assert.deepEqual(await source.access(), { status: "ok", token: "access-2" });
  assert.equal(google.forms.length, 2);
});

test("calls at once share one refresh, and `again` gets a new token", async () => {
  const google = endpoint(granted("access-1"), granted("access-2"));
  const source = googleAccess({
    client: () => client,
    file: memoryFile("r"),
    fetch: google.fetch,
    now: () => 0,
  });
  const both = await Promise.all([source.access(), source.access()]);
  assert.deepEqual(both, [
    { status: "ok", token: "access-1" },
    { status: "ok", token: "access-1" },
  ]);
  assert.deepEqual(await source.access(true), { status: "ok", token: "access-2" });
  assert.equal(google.forms.length, 2);
});

test("a new refresh token from Google is kept on disk", async () => {
  const file = memoryFile("old");
  const source = googleAccess({
    client: () => client,
    file,
    fetch: endpoint(granted("a", "new")).fetch,
    now: () => 0,
  });
  await source.access();
  assert.deepEqual(file.writes, ["new"]);
});

test("no client, no sign-in, or one Google refuses is a sentence, with no token sent", async () => {
  const none = googleAccess({
    client: () => null,
    file: memoryFile("r"),
    fetch: endpoint().fetch,
    now: () => 0,
  });
  // No client in its environment, and none `login` kept, is not signed in.
  assert.equal(((await none.access()) as { problem: string }).problem, notSignedIn);

  const out = googleAccess({
    client: () => client,
    file: memoryFile(null),
    fetch: endpoint().fetch,
    now: () => 0,
  });
  assert.deepEqual(await out.access(), { status: "refused", problem: notSignedIn });

  const revoked = googleAccess({
    client: () => client,
    file: memoryFile("r"),
    fetch: endpoint({
      status: 400,
      body: { error: "invalid_grant", error_description: "Token has been expired or revoked." },
    }).fetch,
    now: () => 0,
  });
  assert.deepEqual(await revoked.access(), {
    status: "refused",
    problem: "The Google sign-in expired or was revoked. Run `sheets-mcp login`.",
  });

  const wrongClient = googleAccess({
    client: () => client,
    file: memoryFile("r"),
    fetch: endpoint({
      status: 401,
      body: {
        error: "invalid_client",
        error_description: `The OAuth client ${client.id} was not found.`,
      },
    }).fetch,
    now: () => 0,
  });
  const problem = ((await wrongClient.access()) as { problem: string }).problem;
  assert.match(
    problem,
    /^Couldn't refresh the sign-in: Google refused this client \(401 invalid_client\)/,
  );
  assert.ok(!problem.includes(client.id));
});

test("what must never be shown: the client, its project's number and every token seen", async () => {
  const source = googleAccess({
    client: () => ({ id: client.id, secret: "GOCSPX-fake-secret" }),
    file: memoryFile("refresh-1"),
    fetch: endpoint(granted("access-1", "refresh-2")).fetch,
    now: () => 0,
  });
  await source.access();
  assert.deepEqual(
    source.secrets().toSorted(),
    [
      client.id,
      "123456789012",
      "GOCSPX-fake-secret",
      "access-1",
      "refresh-1",
      "refresh-2",
    ].toSorted(),
  );
});
