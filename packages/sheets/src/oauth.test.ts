import assert from "node:assert/strict";
import { test } from "node:test";
import type { After } from "./loopback.ts";
import { type Fetch, pickedFiles, refresh, scope, signIn, type SignInIo } from "./oauth.ts";
import { challengeOf } from "./pkce.ts";

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

test("it signs in with PKCE and the Picker, and brings back tokens and the picked files", async () => {
  const google = tokenEndpoint(200, granted);
  const person = browser((authorize) => ({
    code: "4/fake-code",
    state: authorize.searchParams.get("state") ?? "",
    scope,
    picked_file_ids: "1AbC-sheet_one,1DeF-sheet_two",
  }));
  const result = await signIn(client, io(google.fetch, person.open));
  assert.deepEqual(result, {
    status: "signed-in",
    tokens: {
      access: "fake-access-token",
      refresh: "fake-refresh-token",
      expiresAt: now() + 3599 * 1000,
    },
    picked: ["1AbC-sheet_one", "1DeF-sheet_two"],
  });

  const [authorize] = person.opened;
  assert.ok(authorize);
  assert.equal(
    `${authorize.origin}${authorize.pathname}`,
    "https://accounts.google.com/o/oauth2/v2/auth",
  );
  const asked = Object.fromEntries(authorize.searchParams);
  const redirectUri = asked.redirect_uri ?? "";
  assert.match(redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  assert.deepEqual(
    { ...asked, redirect_uri: "", code_challenge: "", state: "" },
    {
      client_id: client.id,
      redirect_uri: "",
      response_type: "code",
      scope: "https://www.googleapis.com/auth/drive.file",
      code_challenge: "",
      code_challenge_method: "S256",
      state: "",
      prompt: "consent",
      trigger_onepick: "true",
      allow_multiple: "true",
      mimetypes: "application/vnd.google-apps.spreadsheet",
    },
  );

  // The exchange proves the verifier behind the challenge, to the same redirect.
  const [exchange] = google.calls;
  assert.equal(google.calls.length, 1);
  assert.equal(exchange?.url, "https://oauth2.googleapis.com/token");
  const form = Object.fromEntries(exchange?.form ?? []);
  assert.equal(challengeOf(form.code_verifier ?? ""), asked.code_challenge);
  assert.deepEqual(
    { ...form, code_verifier: "" },
    {
      grant_type: "authorization_code",
      code: "4/fake-code",
      code_verifier: "",
      redirect_uri: redirectUri,
      client_id: client.id,
      client_secret: client.secret,
    },
  );
});

test("a redirect with the wrong state is refused before any code is exchanged", async () => {
  const google = tokenEndpoint(200, granted);
  const forged = browser(() => ({ code: "4/forged", state: "not-this-sign-ins", scope }));
  assert.deepEqual(await signIn(client, io(google.fetch, forged.open)), {
    status: "failed",
    problem: "a redirect whose state isn't this sign-in's",
  });
  assert.equal(google.calls.length, 0);
});

test("nobody finishing in 5 minutes fails the sign-in", async () => {
  const google = tokenEndpoint(200, granted);
  let fire = () => {};
  const after: After = (_ms, fn) => {
    fire = fn;
    return () => {};
  };
  const idle = browser(() => {
    fire();
    return null;
  });
  assert.deepEqual(await signIn(client, io(google.fetch, idle.open, after)), {
    status: "failed",
    problem: "nobody finished signing in within 5 minutes",
  });
  assert.equal(google.calls.length, 0);
});

test("a browser that doesn't open closes the listener", async () => {
  const google = tokenEndpoint(200, granted);
  let redirectUri = "";
  const broken = async (address: string) => {
    redirectUri = new URL(address).searchParams.get("redirect_uri") ?? "";
    throw new Error("no browser");
  };
  assert.deepEqual(await signIn(client, io(google.fetch, broken)), {
    status: "failed",
    problem: "the browser didn't open",
  });
  await assert.rejects(fetch(redirectUri));
});

test("a refused exchange, or one with no refresh token or scope, fails without quoting a value", async () => {
  const answers: [number, unknown, string][] = [
    [
      400,
      { error: "invalid_grant", error_description: "fake-client-secret-0123" },
      "Google refused the token request (400 invalid_grant)",
    ],
    [200, { ...granted, refresh_token: undefined }, "Google sent no refresh token"],
    [200, { ...granted, scope: "openid" }, "Google didn't grant access to the picked files"],
    [200, { access_token: 7 }, "Google's token answer isn't one Oriel reads"],
  ];
  for (const [status, body, problem] of answers) {
    const google = tokenEndpoint(status, body);
    const person = browser((authorize) => ({
      code: "4/fake-code",
      state: authorize.searchParams.get("state") ?? "",
    }));
    assert.deepEqual(await signIn(client, io(google.fetch, person.open)), {
      status: "failed",
      problem,
    });
  }
});

test("picked file IDs are Drive's shape, or the sign-in fails", () => {
  const picked = (value: string) => pickedFiles(new URLSearchParams({ picked_file_ids: value }));
  assert.deepEqual(picked("a,b, a"), ["a", "b"]);
  assert.deepEqual(pickedFiles(new URLSearchParams()), []);
  assert.equal(picked("a,../b"), null);
  assert.equal(picked("a b"), null);
});

test("a refresh Google refuses is signed out", async () => {
  const google = tokenEndpoint(400, {
    error: "invalid_grant",
    error_description: "Token has been expired or revoked.",
  });
  assert.deepEqual(await refresh(client, "fake-refresh-token", { fetch: google.fetch, now }), {
    status: "signed-out",
  });
  assert.deepEqual(Object.fromEntries(google.calls[0]?.form ?? []), {
    grant_type: "refresh_token",
    refresh_token: "fake-refresh-token",
    client_id: client.id,
    client_secret: client.secret,
  });
});

test("a refresh that fails otherwise isn't signed out", async () => {
  const misconfigured = tokenEndpoint(401, { error: "invalid_client" });
  assert.deepEqual(
    await refresh(client, "fake-refresh-token", { fetch: misconfigured.fetch, now }),
    {
      status: "failed",
      problem: "Google refused the token request (401 invalid_client)",
    },
  );
  const unreachable: Fetch = async () => {
    throw new TypeError("fetch failed");
  };
  assert.deepEqual(await refresh(client, "fake-refresh-token", { fetch: unreachable, now }), {
    status: "failed",
    problem: "Google's token endpoint didn't answer",
  });
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
