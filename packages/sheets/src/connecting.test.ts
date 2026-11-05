import assert from "node:assert/strict";
import { test } from "node:test";
import { type ConnectVia, instant, ulid } from "@oriel/core";
import { secretRefused, sheetsConnect, type SignedIn } from "./connecting.ts";
import { loadSheetsFixture } from "./fixture.ts";
import { scope, tokenEndpoint } from "./oauth.ts";
import { openSheets } from "./open-connection.ts";
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

test("a sign-in begins at Google's page and, once finished there, gives the tokens, picks and account", async () => {
  const { send } = google();
  const begun = await sheetsConnect.browser.begin(via(send));
  assert.ok("url" in begun);
  const authorize = new URL(begun.url);
  assert.equal(authorize.origin, "https://accounts.google.com");
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorize.searchParams.get("trigger_onepick"), "true");
  assert.match(authorize.searchParams.get("redirect_uri") ?? "", /^http:\/\/127\.0\.0\.1:\d+\/$/);
  await finish(begun.url, { code: "4/fake-code", scope, picked_file_ids: picked.join(",") });
  const done = (await begun.done) as SignedIn;
  assert.deepEqual(done.picked, picked);
  assert.equal(done.account.permissionId, fixture.user.permissionId);
  assert.equal(done.account.email, fixture.user.emailAddress);
  assert.equal(await sheetsConnect.identify(done), fixture.user.permissionId);

  // Made: each picked spreadsheet with no tab mapped yet, so it waits for
  // its options; the tokens as its secret; and the account's email as its
  // name.
  const made = await sheetsConnect.make(done);
  assert.deepEqual(made.options, { spreadsheets: picked.map((id) => ({ id, tabs: [] })) });
  assert.equal(made.name, fixture.user.emailAddress);
  assert.equal(JSON.parse(made.secret).refresh, "fake-refresh-token");
});

test("with no email from Drive, the connection keeps its connector's name", async () => {
  const { send } = google({ email: false });
  const begun = await sheetsConnect.browser.begin(via(send));
  assert.ok("url" in begun);
  await finish(begun.url, { code: "4/fake-code", scope, picked_file_ids: picked[0] ?? "" });
  const done = (await begun.done) as SignedIn;
  assert.equal(done.account.email, null);
  assert.equal("name" in (await sheetsConnect.make(done)), false);
});

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

test("without Oriel's Google client's ID, no sign-in begins", async () => {
  const { send, asked } = google();
  const begun = await sheetsConnect.browser.begin(
    via(send, { GOOGLE_CLIENT_SECRET: "only-a-secret" }),
  );
  assert.ok("problem" in begun);
  assert.match(begun.problem, /Google sign-in/);
  assert.deepEqual(asked, []);
});

test("with the client's ID alone, a sign-in sends no secret, and says so plainly if Google wants one", async () => {
  const idOnly = { GOOGLE_CLIENT_ID: client.GOOGLE_CLIENT_ID };
  const taken = await sheetsConnect.browser.begin(via(google().send, idOnly));
  assert.ok("url" in taken);
  await finish(taken.url, { code: "4/fake-code", scope, picked_file_ids: picked[0] ?? "" });
  assert.equal(((await taken.done) as SignedIn).picked.length, 1);

  const logged: string[] = [];
  const begun = await sheetsConnect.browser.begin({
    ...via(google({ wantsSecret: true }).send, idOnly),
    log: (message) => logged.push(message),
  });
  assert.ok("url" in begun);
  await finish(begun.url, { code: "4/fake-code", scope, picked_file_ids: picked[0] ?? "" });
  assert.deepEqual(await begun.done, { problem: secretRefused });
  assert.deepEqual(logged, [
    "sheets: Google refused the code's exchange without the client's secret",
  ]);
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

const now = instant(new Date(Date.UTC(2026, 10, 3, 9)));

test("an access token that ran out is refreshed with Oriel's client, kept, and read with", async () => {
  const { send, asked } = google();
  const keptAgain: string[] = [];
  const ran = {
    access: "an-old-token",
    refresh: "fake-refresh-token",
    expiresAt: Date.parse(now) - 1,
  };
  const opened = await openSheets(
    { ...kept(ran), options: { spreadsheets: [{ id: picked[0] ?? "", tabs: [] }] } },
    {
      fetch: send,
      kept: true,
      log: () => {},
      now: () => now,
      client,
      keep: async (secret) => void keptAgain.push(secret),
    },
  );
  for await (const page of opened.source.sync(null)) assert.ok(page);
  assert.equal(asked.filter((url) => url === tokenEndpoint).length, 1);
  assert.equal(keptAgain.length, 1);
  assert.equal(JSON.parse(keptAgain[0] ?? "{}").access, standInToken);

  // Refused: signed out, which signing in again fixes.
  const refused = await openSheets(kept(ran), {
    fetch: google({ refused: true }).send,
    kept: true,
    log: () => {},
    now: () => now,
    client,
  });
  const failed = await (async () => {
    for await (const page of refused.source.sync(null)) assert.ok(page);
  })().then(
    () => null,
    (error: unknown) => error,
  );
  assert.match(refused.problem(failed), /signing in again/);
});
