// Connecting Google Sheets in the window (decisions 0050 and 0051), against
// the Sheets fixture's stand-in for Google: what the sign-in gave never
// reaches the page, signing in again keeps what the connection held, and
// asking about a tab sends the agent its ID, never the sheet's words.
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { fixtureGoogle, loadSheetsFixture, scope, standInToken } from "@oriel/sheets";
import type { OptionsReviewView } from "@oriel/web/view";
import { json, type Script, testApp } from "./testing.ts";

// Made-up values; none is a real client or token.
const client = {
  GOOGLE_CLIENT_ID: "fake-client.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "fake-secret",
};
const fixture = loadSheetsFixture();
const idOf = (slug: string) => fixture.spreadsheets.find((s) => s.slug === slug)?.id ?? "";
const tracker = idOf("tracker");
const raid = idOf("raid");

// Google: the stand-in for Drive and Sheets, and a token endpoint that
// grants the stand-in's token, for an hour or as `token` says, or refuses
// a refresh once `token.refuses`.
function google() {
  const standIn = fixtureGoogle(fixture);
  const token = { seconds: 3599, refuses: false };
  const send: typeof fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === "https://oauth2.googleapis.com/token") {
      const refreshing =
        new URLSearchParams(String(init?.body)).get("grant_type") === "refresh_token";
      if (refreshing && token.refuses)
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      return Response.json({
        access_token: standInToken,
        expires_in: token.seconds,
        refresh_token: "fake-refresh-token",
        scope,
      });
    }
    return standIn.fetch(input, init);
  };
  return { standIn, send, token };
}

// Asked to change a tab of a connection that reads (OA-232): its options,
// as preview() gives them, by letter, with the tracker's tab changed as
// `fix` says, by default its key moved to its ID column, and every other
// tab kept.
const fix = (tab: { key: string }): object => ({ ...tab, key: "A" });
const fixing: Script = async (bindings) => {
  const [reads] = (await bindings.read("source.preview", [])).value as {
    connection: string;
    why: string;
    options: { tabs: { at: string; key: string }[] };
    tables: { at?: string }[];
  }[];
  const tabs = reads?.options.tabs.map((tab) => (tab.at === `${tracker}/1100` ? fix(tab) : tab));
  return {
    value: { why: reads?.why, first: reads?.tables[0]?.at, tabs: reads?.options.tabs.length },
    drafts: [["source.configure", [{ connection: reads?.connection, options: { tabs } }]]],
  };
};

async function sheetsApp(t: TestContext, options: { clients?: false } = {}) {
  const { standIn, send, token } = google();
  const turns: string[] = [];
  const it = await testApp(t, {
    sources: { sheets: { mode: "window", fetch: send } },
    ...(options.clients === false ? {} : { clients: { sheets: client } }),
    plan: (input) => {
      turns.push(input.text);
      return input.text.startsWith("Draft a change")
        ? [{ run: "fix" }, { text: "Drafted." }]
        : [{ text: "Hi." }];
    },
    scripts: { fix: fixing },
  });
  return { ...it, standIn, token, turns };
}

// The person's browser, following Google's page back to the redirect.
async function finish(url: string, picked: string[]) {
  const authorize = new URL(url);
  const back = new URL(authorize.searchParams.get("redirect_uri") ?? "");
  back.searchParams.set("state", authorize.searchParams.get("state") ?? "");
  back.searchParams.set("code", "4/fake-code");
  back.searchParams.set("scope", scope);
  back.searchParams.set("picked_file_ids", picked.join(","));
  await (await fetch(back)).text();
}

async function connected(it: Awaited<ReturnType<typeof sheetsApp>>) {
  const begun = json<{ url: string; attempt: string }>(
    await it.post("/api/connections/browser", { kind: "sheets" }),
  );
  assert.equal(new URL(begun.url).origin, "https://accounts.google.com");
  assert.equal(JSON.stringify(begun).includes("verifier"), false);
  const [reply] = await Promise.all([
    it.connect("sheets", { attempt: begun.attempt }),
    finish(begun.url, [tracker, raid]),
  ]);
  assert.equal(reply.status, 200, String(reply.body));
  const sheets = await it.connection("sheets");
  assert.ok(sheets);
  return sheets;
}

test("nothing Google's sign-in gave reaches the page, and a sign-in's ID finishes it once", async (t) => {
  const it = await sheetsApp(t);
  await connected(it);
  const listed = JSON.stringify(json(await it.get("/api/connections")));
  assert.equal(listed.includes(standInToken), false);
  assert.equal(listed.includes("fake-refresh-token"), false);
  assert.equal((await it.connect("sheets", { attempt: "0".repeat(32) })).status, 400);
});

test("a connection Google signs out reads as signed out, and signing in again keeps its mapping and items", async (t) => {
  const it = await sheetsApp(t);
  // Tokens that last a minute are refreshed at every read.
  it.token.seconds = 60;
  const sheets = await connected(it);
  const { guess } = json<OptionsReviewView>(await it.get(`/api/connections/${sheets.id}/review`));
  await it.post(`/api/connections/${sheets.id}/options`, { options: guess?.options });
  const mapped = await it.connection("sheets");
  assert.equal(mapped?.state, "open");

  it.token.refuses = true;
  assert.notEqual((await it.sync("sheets")).status, 200);
  assert.equal((await it.connection("sheets"))?.state, "signed-out");

  it.token.refuses = false;
  const again = await connected(it);
  assert.deepEqual(
    [again.id, again.state, again.options, again.items, again.problem],
    [mapped?.id, "open", mapped?.options, mapped?.items, null],
  );
});

test("Ask Oriel about a tab names it by its ID alone: no words of the sheet reach the agent's turn", async (t) => {
  const it = await sheetsApp(t);
  const sheets = await connected(it);
  const { guess } = json<OptionsReviewView>(await it.get(`/api/connections/${sheets.id}/review`));
  await it.post(`/api/connections/${sheets.id}/options`, { options: guess?.options });
  const at = `${tracker}/1100`;
  // Only one of its own tables, by its place.
  assert.equal((await it.post(`/api/connections/${sheets.id}/draft`, { tab: "x/1" })).status, 400);
  assert.equal(
    (await it.post(`/api/connections/${sheets.id}/draft`, { tab: "Tracker" })).status,
    400,
  );
  assert.equal((await it.post(`/api/connections/${sheets.id}/draft`, { tab: at })).status, 201);
  await it.app.settled();
  const turn = it.turns.at(-1) ?? "";
  assert.ok(turn.includes(at));
  const words = fixture.spreadsheets.flatMap((s) => [s.title, ...s.tabs.map((tab) => tab.title)]);
  // The ID itself may hold a word; nothing else in the turn does.
  const rest = turn.replace(at, "");
  for (const word of words) assert.ok(!rest.includes(word), word);
});
