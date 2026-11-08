import assert from "node:assert/strict";
import { test } from "node:test";
import type { After } from "./loopback.ts";
import { type Fetch, pickedFiles, refresh, scope, signIn, type SignInIo } from "./oauth.ts";

// Made-up values; none is a real client or token.
const client = { id: "fake-client.apps.googleusercontent.com", secret: "fake-client-secret-0123" };
const now = () => 1_800_000_000_000;
const never: After = () => () => {};

type Call = { url: string; form: URLSearchParams };

// Google's token endpoint, answering every request with one reply.
function tokenEndpoint(status: number, body: unknown) {
  const calls: Call[] = [];
  const fetch: Fetch = async (input, init) => {
    calls.push({ url: String(input), form: new URLSearchParams(String(init?.body)) });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fetch, calls };
}

const granted = {
  access_token: "fake-access-token",
  expires_in: 3599,
  refresh_token: "fake-refresh-token",
  scope,
  token_type: "Bearer",
};

// A browser that follows Google's page straight back to the redirect, with
// what `answer` makes of the authorize URL.
function browser(answer: (authorize: URL) => Record<string, string> | null) {
  const opened: URL[] = [];
  const open = async (address: string) => {
    const authorize = new URL(address);
    opened.push(authorize);
    const query = answer(authorize);
    if (query === null) return;
    const back = new URL(authorize.searchParams.get("redirect_uri") ?? "");
    for (const [name, value] of Object.entries(query)) back.searchParams.set(name, value);
    await (await fetch(back)).text();
  };
  return { open, opened };
}

const io = (fetch: Fetch, open: SignInIo["open"], after: After = never): SignInIo => ({
  fetch,
  open,
  now,
  after,
});

test("a redirect with the wrong state is refused before any code is exchanged", async () => {
  const google = tokenEndpoint(200, granted);
  const forged = browser(() => ({ code: "4/forged", state: "not-this-sign-ins", scope }));
  assert.equal((await signIn(client, io(google.fetch, forged.open))).status, "failed");
  assert.equal(google.calls.length, 0);
});

test("a refused exchange fails without quoting a value", async () => {
  const google = tokenEndpoint(400, {
    error: "invalid_grant",
    error_description: "fake-client-secret-0123",
  });
  const person = browser((authorize) => ({
    code: "4/fake-code",
    state: authorize.searchParams.get("state") ?? "",
  }));
  const result = await signIn(client, io(google.fetch, person.open));
  assert.equal(result.status, "failed");
  const said = JSON.stringify(result);
  for (const value of ["fake-client-secret-0123", "4/fake-code", client.secret ?? ""])
    assert.ok(!said.includes(value), value);
});

test("picked file IDs are Drive's shape, or the sign-in fails", () => {
  const picked = (value: string) => pickedFiles(new URLSearchParams({ picked_file_ids: value }));
  assert.deepEqual(picked("a,b, a"), ["a", "b"]);
  assert.deepEqual(pickedFiles(new URLSearchParams()), []);
  assert.equal(picked("a,../b"), null);
  assert.equal(picked("a b"), null);
});

test("a refresh that fails otherwise isn't signed out", async () => {
  const misconfigured = tokenEndpoint(401, { error: "invalid_client" });
  assert.equal(
    (await refresh(client, "fake-refresh-token", { fetch: misconfigured.fetch, now })).status,
    "failed",
  );
  const unreachable: Fetch = async () => {
    throw new TypeError("fetch failed");
  };
  assert.equal(
    (await refresh(client, "fake-refresh-token", { fetch: unreachable, now })).status,
    "failed",
  );
});

test("a refresh keeps the refresh token unless Google sends a newer one", async () => {
  const same = tokenEndpoint(200, { access_token: "fake-access-2", expires_in: 3599, scope });
  assert.deepEqual(await refresh(client, "fake-refresh-token", { fetch: same.fetch, now }), {
    status: "refreshed",
    tokens: { access: "fake-access-2", refresh: "fake-refresh-token", expiresAt: now() + 3599_000 },
  });
  const rotated = tokenEndpoint(200, { ...granted, refresh_token: "fake-refresh-2" });
  const result = await refresh(client, "fake-refresh-token", { fetch: rotated.fetch, now });
  assert.equal(result.status === "refreshed" && result.tokens.refresh, "fake-refresh-2");
});
