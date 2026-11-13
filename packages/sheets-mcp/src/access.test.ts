import assert from "node:assert/strict";
import { test } from "node:test";
import { googleAccess } from "./access.ts";
import { type Fetch, tokenEndpoint } from "./oauth.ts";
import type { TokenFile } from "./token-file.ts";

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

test("Google refusing the client is refused without naming the client", async () => {
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
  const answer = await wrongClient.access();
  assert.equal(answer.status, "refused");
  assert.ok(!JSON.stringify(answer).includes(client.id));
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
