import assert from "node:assert/strict";
import { test } from "node:test";
import { type ConnectVia, ulid } from "@oriel/core";
import { sheetsConnect } from "./connecting.ts";
import { loadSheetsFixture } from "./fixture.ts";
import { scope, tokenEndpoint } from "./oauth.ts";
import { driveOrigin, fixtureGoogle, standInToken } from "./stand-in.ts";

// Made-up values; none is a real client or token.
const client = {
  GOOGLE_CLIENT_ID: "fake-client.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "fake-secret",
};
const fixture = loadSheetsFixture();
const picked = fixture.spreadsheets.slice(0, 2).map((s) => s.id);

// Google: its token endpoint, granting the stand-in's token, and Drive's
// `about` through the stand-in, its email left out when `email` is false.
// With `wantsSecret`, it refuses a code's exchange sent with no secret.
function google(options: { email?: boolean; refused?: boolean; wantsSecret?: boolean } = {}) {
  const standIn = fixtureGoogle(fixture);
  const asked: string[] = [];
  const send: typeof fetch = async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    asked.push(`${url.origin}${url.pathname}`);
    if (url.href === tokenEndpoint) {
      const form = new URLSearchParams(String(init?.body));
      if (options.refused) return Response.json({ error: "invalid_grant" }, { status: 400 });
      if (options.wantsSecret && !form.has("client_secret"))
        return Response.json(
          { error: "invalid_request", error_description: "client_secret is missing." },
          { status: 400 },
        );
      return Response.json({
        access_token: standInToken,
        expires_in: 3599,
        refresh_token: form.get("refresh_token") ?? "fake-refresh-token",
        scope,
      });
    }
    if (
      url.origin === driveOrigin &&
      url.pathname === "/drive/v3/about" &&
      options.email === false
    ) {
      const answered = await standIn.fetch(input, init);
      const body = (await answered.json()) as { user: Record<string, unknown> };
      delete body.user.emailAddress;
      return Response.json(body);
    }
    return standIn.fetch(input, init);
  };
  return { send, asked };
}

const via = (send: typeof fetch, given: Record<string, string> = client): ConnectVia => ({
  anywhere: true,
  log: () => {},
  fetch: send,
  client: given,
});

// The person's browser, which follows Google's page back to the redirect.
async function finish(url: string, query: Record<string, string>) {
  const authorize = new URL(url);
  const back = new URL(authorize.searchParams.get("redirect_uri") ?? "");
  back.searchParams.set("state", authorize.searchParams.get("state") ?? "");
  for (const [name, value] of Object.entries(query)) back.searchParams.set(name, value);
  await (await fetch(back)).text();
}

test("a sign-in Google refuses, or with nothing picked, connects nothing and says so plainly", async () => {
  for (const query of [{ error: "access_denied" }, { code: "4/fake-code", scope }] as Record<
    string,
    string
  >[]) {
    const begun = await sheetsConnect.browser.begin(via(google().send));
    assert.ok("url" in begun);
    await finish(begun.url, query);
    const done = await begun.done;
    assert.ok("problem" in done);
    assert.doesNotMatch(done.problem, /4\/fake-code|access_denied/);
  }
});

const kept = (tokens: Record<string, unknown>) => ({
  id: ulid(1, new Uint8Array(10)),
  number: 1,
  prefix: "sheets",
  identity: fixture.user.permissionId,
  options: { spreadsheets: picked.map((id) => ({ id, tabs: [] })) },
  secret: JSON.stringify(tokens),
});

test("a kept connection opens unless Google refuses its refresh, when it is signed out", async () => {
  const live = {
    access: standInToken,
    refresh: "fake-refresh-token",
    expiresAt: Number.MAX_SAFE_INTEGER,
  };
  assert.equal(await sheetsConnect.vet(kept(live), via(google({ refused: true }).send)), true);
  const ran = { ...live, expiresAt: 0 };
  assert.equal(await sheetsConnect.vet(kept(ran), via(google().send)), true);
  assert.equal(await sheetsConnect.vet(kept(ran), via(google({ refused: true }).send)), false);
  assert.equal(
    await sheetsConnect.vet(kept({ access: standInToken, expiresAt: 0 }), via(google().send)),
    false,
  );
});
